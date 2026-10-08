---
id: INF-021
title: Expose queue.oldestDueSec and workers.live in the admin health endpoint
labels: [type:feature, area:infra, area:admin, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-014, ADM-022]
epic: EPIC-OBS
---

## Context
Deferred from ADM-022 (PR for #74): the jobs dashboard computes queue health, and its scope said the health endpoint (INF-014) "exposes `queue.oldestDueSec` and `workers.live` for alerting". INF-014 has not landed, so there is no admin `/api/health` to extend yet. ADM-022 shipped the pieces: `queueHealth(summary, live)` in `apps/admin/src/lib/jobs.ts` (pure, tested) and `loadJobHealth()` in `apps/admin/src/lib/jobQueries.ts` (one raw aggregate + heartbeat lookup).

## Scope
- In the admin health route from INF-014, add a `queue` and `workers` section built with `queueHealth(...)` from `loadJobHealth()`: `{ queue: { depth, oldestDueSec, retrying, dead }, workers: { live } }`.
- Not part of the ok/503 decision by default (a stopped worker must not fail the admin liveness probe); optional thresholds via env (`HEALTH_MAX_OLDEST_DUE_SEC`, `HEALTH_MIN_WORKERS`) mark `checks.queue.ok=false` when exceeded.
- Skipped for `?live=1`.

## Out of scope
- Alerting rules and the metrics vendor.

## Acceptance criteria
- [ ] `curl :3001/api/health` includes `queue.oldestDueSec` and `workers.live` on the running stack.
- [ ] With `HEALTH_MIN_WORKERS=1` and no worker running, `checks.queue.ok` is false (unit test on the pure decision).
- [ ] `?live=1` does not run the job aggregate.

## Files
- `apps/admin/src/app/api/health/route.ts` (from INF-014), `apps/admin/src/lib/jobs.ts` + test

## Verification
```bash
pnpm --filter @hub/admin test
curl -s localhost:3001/api/health | jq '.queue, .workers'
```

## Notes for agents
First failing test: the threshold decision as a pure function next to `queueHealth` in `lib/jobs.ts`.
