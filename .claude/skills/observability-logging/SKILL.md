---
name: observability-logging
description: Use when adding logs, audit entries, health checks or error reporting, or when debugging across web/admin/worker: current console logging and Python logging, AuditLog conventions (action names like rsvp.respond, faceindex.purge, invites.send; who writes them; apps/admin/src/lib/audit.ts), the planned pino + OpenTelemetry + Sentry design from docs/01 §10, where requestId/studioId/eventId context belongs, reading dev logs, the admin Jobs/Audit pages, and health endpoints (/api/health, worker /health).
---

# Observability and logging

## When this applies
- Adding a log line, an audit row, or a health/readiness signal.
- Debugging "it did not happen": job stuck, email missing, permission denied.
- Starting the structured-logging / tracing work.

## Where things live (current state)

| Layer | Mechanism | Where to read |
|---|---|---|
| web / admin | `console.error("[action]", e)` in `act()`; `console.error("[sign-in] failed")`, `console.warn("[face-search] worker unreachable")`, `console.error("[face-search] ...")`; console email/SMS senders print full bodies | the `pnpm dev` terminal (both apps interleaved; `pnpm dev:web` / `dev:admin` to separate). Prisma logs `warn`/`error`, plus `query` when `PRISMA_LOG=1` |
| worker | stdlib `logging`, `%(asctime)s %(levelname)s %(name)s: %(message)s`, level `WORKER_LOG_LEVEL` (INFO); one summary line per job with ms timings; failures logged with attempt counts | the `make dev` / `make consume` terminal |
| Job outcomes | `Job.status`, `attempts/maxAttempts`, `lastError` (last 4000 chars incl. traceback), `lockedBy` (`host:pid`), `runAt` | `http://localhost:3001/platform/jobs` (platform admin; counts by status/type, last 50, Retry) or SQL |
| Audit trail | `AuditLog { studioId?, eventId?, actorUserId?, action, target?, data Json?, createdAt }`, index `(studioId, createdAt)` | `http://localhost:3001/platform/audit` (last 200) or SQL |
| Health | `GET http://localhost:3000/api/health` -> `{ok:true}` (no DB check); worker `GET :8010/health` -> `{ok, models_loaded, models_present, model}`; Postgres `pg_isready`; Mailpit `/api/v1/info` | curl |
| Errors | none centralised (no Sentry); Next shows overlays in dev | terminal |

There is no `requestId`, no structured JSON, no tracing yet.

## AuditLog conventions (observed)
- **Name = `<noun>.<verb>`**, lowercase, dot-separated, optional third segment for a sub-state: `photo.hide` / `photo.unhide`, `event.facesearch.enable`, `faceindex.purge.request`.
- **Who writes:** admin via `audit()` helper in `apps/admin/src/lib/audit.ts`; web inline `prisma.auditLog.create` (in a transaction with the change when there is one); worker via raw `INSERT INTO "AuditLog"` without `actorUserId` (system).
- **Fields:** `studioId`/`eventId` whenever known (worker always sets both); `actorUserId` = acting user or null for system; `target` = id of the thing changed (or page type / event id); `data` = small JSON with before/after or counts, never PII beyond what the row already implies (emails appear in `event.member.add` and `studio.create` data today).
- **Request vs effect pairs:** admin logs `faceindex.purge.request`, the worker logs `faceindex.purge` when done; same for `faceindex.reindex.request` -> `faceindex.cluster`.

Known action names: `album.delete`, `album.visibility`, `auth.invite_link`, `auth.magic_link`, `consent.grant`, `dsar.biometric.delete` (`target` = a ticket id, never an email or name; `data` = counts only; written by the operator SQL in `docs/compliance/runbook-biometric-deletion.md`), `entitlement.grant`, `entitlement.revoke`, `event.create`, `event.facesearch.enable|disable`, `event.member.add|remove`, `event.page.update`, `event.retention.change`, `event.settings.update`, `face.search`, `faceindex.cluster`, `faceindex.purge`, `faceindex.purge.request`, `faceindex.reindex.request`, `guest.delete`, `guests.import`, `household.delete`, `invite.extend` (`{ count, expiresAt }`, written by admin when a schedule/settings change pushed live invite tokens out to the new event end + 90 d), `invite.resend`, `invites.send`, `job.retry`, `photo.delete`, `photo.download`, `photo.hide|unhide`, `reminder.create|delete`, `rsvp.export`, `rsvp.respond`, `studio.create`, `studio.member.add|remove`, `studio.retention.change`, `studio.settings.update`.

## Conventions in this repo
- **Audit for permission, visibility, consent, export, deletion and retention changes** (docs/01 §10). Reads are not audited except `photo.download` and `rsvp.export` (data leaving the system).
- **Log prefixes in brackets** on the Node side (`[action]`, `[sign-in]`, `[face-search]`) so grep works; include ids, not objects.
- **Never log**: tokens, cookies, selfie bytes/embeddings, full guest lists. `send_message.py` strips `body`/`html` from its log line -- follow that.
- Worker timings in ms per stage (`detect`, `embed`, `total`) are the throughput signal docs/01 §5 cares about.

## Common tasks

### Add an audit row for a new mutation
1. Test first: if the mutation has a pure core, a vitest test on it; otherwise write the smoke check you will run (SQL below) into the PR.
2. Admin: `await audit({ studioId, eventId, actorUserId: p.userId, action: "registry.item.claim", target: itemId, data: { quantity } })` after the write (or inside the `$transaction` with `tx.auditLog.create` when atomicity matters).
3. Web: `tx.auditLog.create({ data: { ... } })` inside the transaction (see `rsvp/actions.ts`).
4. Worker: `INSERT INTO "AuditLog"("studioId","eventId",action,target,data) VALUES (...)` with `jsonb()`.
5. Add the name to the list above and, if it is a new noun, to the schema comment on `AuditLog.action`.

### Add a dependency check to `/api/health`
1. Test first: a vitest test for a pure `summarize(checks)` -> `{ ok, checks }`.
2. In `apps/web/src/app/api/health/route.ts`: `await prisma.$queryRaw\`SELECT 1\`` with a timeout; `fetch(env().WORKER_INTERNAL_URL + "/health")`; return 503 when a required check fails. Keep the response small; it will be polled.

### Debug a missing effect
```bash
# did the action run? (audit)
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT "createdAt",action,target,data FROM "AuditLog" ORDER BY id DESC LIMIT 20;'
# did the job run?
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT id,type,status,attempts,"runAt","lockedBy",left("lastError",120) FROM "Job" ORDER BY id DESC LIMIT 20;'
# worker alive? models?
curl -s localhost:8010/health
# mail?
curl -s 'http://localhost:8025/api/v1/messages?limit=5' | jq '.messages[]|{To,Subject,Created}'
```
Admin pages: `/platform/jobs`, `/platform/audit`. Smoke scripts: `apps/admin/scripts/smoke-check-*.mts`.

## Planned design (docs/01 §10) and where context goes
- **Structured JSON logs with `requestId`, `studioId`, `eventId`** via pino (Node) and `python-json-logger`/structlog (worker); **OpenTelemetry traces**; **Sentry or GlitchTip** for errors; backend-agnostic (Grafana/Honeycomb/Axiom).
- Where to attach context when implementing:
  - Node: generate `requestId` in `apps/web/src/middleware.ts` (edge) and forward as `x-hub-request-id` next to `x-hub-slug`; read it in `getSite()`/`requireAdmin()` and create a child logger `log.child({ requestId, studioId, eventId, userId })` stored in `AsyncLocalStorage`. Replace `console.*` in `act()`, `requestSignIn`, face search.
  - Worker: `logging.LoggerAdapter` with `job_id`, `type`, `studioId`, `eventId` in `run_once()`; handlers already know the ids from their first SELECT.
  - Propagate `requestId` into `Job.payload` (`{ ..., requestId }`) so a job log can be tied to the originating request; put it in `AuditLog.data` too.
- Health: a studio-admin jobs dashboard with queue depth/failures/retries (the platform Jobs page is the seed).
- Backups/versioning are provider concerns (daily PITR, bucket versioning on originals).

## Gotchas
- `act()` logs the full error object to the console but returns only `e.message` to the UI -- look at the terminal, not the form.
- The worker's `lastError` is truncated to the last 4000 chars; the head of long tracebacks is cut. The full traceback is in the worker terminal at WARNING.
- `AuditLog.id` is `BigInt`; serialize with `String()` in React keys/JSON.
- `revalidatePath` after an audit write is what makes `/platform/audit` show the new row on next load; the page is `force-dynamic` anyway.
- Two Next dev servers share one terminal under `pnpm dev`; prefix lines are the only way to tell them apart.
- `console.log` in server components runs on the server, not in the browser devtools.

## Verification
```bash
curl -s http://localhost:3000/api/health; curl -s http://localhost:8010/health
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT action,count(*) FROM "AuditLog" GROUP BY 1 ORDER BY 2 DESC;'
cd workers/media && WORKER_LOG_LEVEL=DEBUG make consume   # verbose worker
```

## References
- `docs/01-architecture.md` §10 Observability and operations
- `docs/03-data-model.md` (AuditLog in the Privacy group; purge is "a few DELETEs plus an AuditLog row")
- pino: https://getpino.io/; OpenTelemetry JS: https://opentelemetry.io/docs/languages/js/; Sentry Next.js: https://docs.sentry.io/platforms/javascript/guides/nextjs/
- Related skills: `python-media-worker`, `admin-app-patterns`, `docker-local-infra`
