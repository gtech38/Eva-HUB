---
id: SHR-015
title: Structured logging in TypeScript (pino) and Python (JSON) with correlation ids
labels: [type:feature, area:shared, area:worker, area:web, area:admin, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-OBS
---

## Context
`console.log/warn/error` calls with emoji prefixes (`email.ts`, `sms.ts`), `console.error("[face-search] ...")`, and Python `%(asctime)s %(levelname)s` lines cannot be filtered by tenant or request in production. docs/01 §10: "structured JSON logs with requestId, studioId and eventId".

## Scope
- `packages/shared/src/log.ts`: `pino` logger (`level` from `LOG_LEVEL`, pretty transport only when `NODE_ENV=development` and stdout is a TTY), `withContext({ requestId, studioId, eventId, userId })` via `AsyncLocalStorage`; `log.child()` helpers; redaction of `authorization`, `cookie`, `token`, `embedding`.
- Next apps: `middleware.ts` generates/propagates `x-request-id`; `apps/*/src/lib/log.ts` reads headers and sets context for server components, route handlers and server actions (a small `withRequestLog()` wrapper used by `act()` and route handlers); replace all `console.*` in `apps/**/src` and `packages/shared/src` (ESLint `no-console: error` with the logger module allowlisted).
- Web → worker: send `x-request-id` on `/embed-selfie`; worker logs it. Jobs: `enqueue()` stores `requestId` in `payload._meta`; worker logs `jobId/type/eventId/requestId` on every line via a `logging.LoggerAdapter`.
- Python: `hub_worker/logging_setup.py` JSON formatter (`python-json-logger` or stdlib) with `ts, level, logger, msg, jobId, jobType, eventId, studioId, requestId, durationMs`; `WORKER_LOG_FORMAT=json|text` (text default for `make dev`).
- Face-pipeline timings already logged per job become fields (`detectMs`, `embedMs`, `faces`) so dashboards can aggregate (replaces a separate metrics ticket).
- Tests: logger emits valid JSON with context fields; redaction removes a token; worker adapter adds job fields (pytest capturing stdout).

## Out of scope
- Shipping logs to a vendor (documented in DOC-006). Traces (INF-012).

## Acceptance criteria
- [ ] `pnpm lint` fails on a new `console.log` in `apps/web/src`.
- [ ] A face search request produces web and worker log lines sharing one `requestId` (integration test reading captured stdout of both, or e2e with log files).
- [ ] `WORKER_LOG_FORMAT=json make consume` emits one JSON object per line (pytest).
- [ ] No embedding values appear in any log line (redaction test).

## Files
- `packages/shared/src/log.ts` + test (new), `packages/shared/src/{email,sms,storage,auth}.ts`, `packages/db/src/index.ts`
- `apps/web/src/{middleware.ts,lib/log.ts}`, `apps/admin/src/{middleware.ts,lib/log.ts,lib/action.ts}`, all `console.*` call sites, `eslint.config.mjs`
- `workers/media/hub_worker/{logging_setup.py,__main__.py,jobs.py,api.py}`, `workers/media/tests/test_logging.py` (new)

## Verification
```bash
pnpm lint && pnpm test
cd workers/media && WORKER_LOG_FORMAT=json make test
```

## Notes for agents
First failing test: JSON shape with context. `pino` must be in `serverExternalPackages` for Next. Edge middleware cannot use `AsyncLocalStorage`; only generate the id there.
