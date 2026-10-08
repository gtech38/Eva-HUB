---
id: EPIC-OBS
title: Observability, health and operations
labels: [type:epic, area:infra, priority:p1, size:L]
milestone: Phase 1 — MVP
---

## Context
Logging is `console.*` in TS and `logging.basicConfig` text in Python; nothing carries a request id, studio or event. There are no traces, no error reporting, and the jobs page shows counts but not queue health. Backups and restore are undocumented. docs/01 §10 lists the target: structured JSON logs with `requestId/studioId/eventId`, OpenTelemetry, Sentry or GlitchTip, audit trail, backups with PITR, a jobs health dashboard.

## Children
- SHR-015 Structured logging in TypeScript (pino) and Python (JSON)
- INF-014 Health endpoints with dependency checks and env-gated error reporting
- ADM-022 Jobs dashboard health: queue depth, oldest queued age, failure rate, throughput
- INF-012 OpenTelemetry traces for Next apps and the worker
- DOC-003 Postgres backups, PITR, bucket versioning and a restore drill script
- ADM-023 Audit log retention and export
- INF-022 Expose queue.oldestDueSec and workers.live in the admin health endpoint
- INF-023 Production backup schedule, least-privilege backup credentials, quarterly real-size drill

## Definition of Done
- [ ] One request's log lines across web → worker share a correlation id and parse as JSON.
- [ ] `/api/health` on web, admin and worker reports DB and S3 reachability; CI and the compose stack use them.
- [ ] An unhandled exception in any service appears in the error tracker when configured and in logs otherwise.
- [ ] A restore drill from backup to a fresh database has been executed and documented with timings.
