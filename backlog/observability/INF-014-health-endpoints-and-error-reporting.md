---
id: INF-014
title: Health endpoints with dependency checks and env-gated error reporting (Sentry/GlitchTip)
labels: [type:feature, area:infra, area:web, area:admin, area:worker, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [SHR-015]
epic: EPIC-OBS
---

## Context
`apps/web/src/app/api/health/route.ts` exists (content unknown to orchestration), admin has none, and the worker's `/health` reports model status only. docs/01 §10: "Errors: Sentry, or self-hosted GlitchTip." Deploy targets (INF-018) need liveness/readiness.

## Scope
- Health contract for all three services: `GET /api/health` (web, admin) and `GET /health` (worker) return `{ ok, version, checks: { db: { ok, ms }, s3: { ok, ms }, worker?: { ok } , models?: {...} } }`, 200 when all ok else 503; `?live=1` returns 200 without dependency checks (liveness). `version` from `GIT_SHA` env set by the Dockerfiles (INF-015).
- Web health checks worker `/health?live=1`; admin checks DB + S3; worker checks DB + S3 + models.
- Error reporting: `@sentry/nextjs` in both apps and `sentry-sdk` in the worker, initialised only when `SENTRY_DSN` is set (GlitchTip is DSN-compatible); `tracesSampleRate 0` here (INF-012 handles tracing); PII scrubbing (`sendDefaultPii: false`, strip cookies, emails, embeddings); release = `GIT_SHA`; `act()` and `run_once()` capture exceptions with `jobId/type/eventId` tags.
- docker compose `healthcheck` entries for web/admin/worker in the prod compose (INF-018 consumes).
- Tests: health route returns 503 when the DB check throws (mock), 200 otherwise; Sentry init is skipped without DSN (unit).

## Out of scope
- Alerting rules (DOC-006 mentions). Uptime monitoring vendor.

## Acceptance criteria
- [ ] `curl localhost:3000/api/health`, `:3001/api/health`, `:8010/health` all return the same JSON shape with `db.ok` and `s3.ok` true on the running stack.
- [ ] Stopping Postgres makes all three return 503 within one request (manual, documented) and the vitest/pytest mocks cover it.
- [ ] A thrown error in a server action is reported with `requestId` tag when `SENTRY_DSN` is set (test using Sentry's test transport).

## Files
- `apps/web/src/app/api/health/route.ts`, `apps/admin/src/app/api/health/route.ts` (new), `workers/media/hub_worker/api.py`, `packages/shared/src/health.ts` (new shared checks)
- `apps/web/sentry.*.config.ts`, `apps/admin/sentry.*.config.ts`, `apps/*/src/instrumentation.ts`, `workers/media/hub_worker/__main__.py`, `.env.example`

## Verification
```bash
pnpm test && cd workers/media && make test
curl -s localhost:8010/health | jq .checks
```

## Notes for agents
First failing test: 503 when DB check throws. Keep health handlers cheap (one `SELECT 1`, one `HeadBucket`) and never log secrets.
