---
id: ADM-022
title: Jobs dashboard health: queue depth, oldest queued age, failure rate, throughput, worker heartbeat
labels: [type:feature, area:admin, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-OBS
---

## Context
`apps/admin/src/app/platform/jobs/page.tsx` shows counts by status/type and the last 50 rows. docs/01 §10: "a jobs dashboard in the studio admin showing queue depth, failures and retries." When 2,000 photos are uploading, the studio needs "how long until done" and "is the worker alive", and failures parked as `QUEUED` with `lastError` (see worker README) are invisible today.

## Scope
- Metrics block: per type — queued (`status=QUEUED AND runAt<=now()`), scheduled (`runAt>now()`), running, oldest due age (`now()-min(runAt)`), succeeded/failed in the last hour (needs `finishedAt DateTime?` on `Job` + migration, set by the worker in `mark_succeeded/mark_failed`), retrying (`QUEUED AND lastError IS NOT NULL`), dead; p50/p95 duration from `finishedAt - lockedAt`.
- Worker heartbeat: `WorkerHeartbeat(workerId PK, lastSeenAt, version, hostname)` upserted every poll loop iteration (≤ 1/5 s) in `consume_forever`; dashboard shows live workers (seen < 30 s) and warns when none.
- Event-scoped view: `/studios/[studioId]/events/[eventId]/jobs` (owner/staff) showing the same for jobs whose `payload.eventId` matches, plus "ETA" = queued × p50 / workers.
- Actions: retry (exists), "retry all dead of type", cancel a scheduled job (owner only; audited `job.cancel`).
- Health endpoint (INF-014) exposes `queue.oldestDueSec` and `workers.live` for alerting.

## Out of scope
- Historical charts beyond 24 h (logs/metrics vendor).

## Acceptance criteria
- [ ] Pure `summarizeJobs(rows, now)` unit-tested for depth, oldest age, retrying count and percentiles.
- [ ] Worker writes a heartbeat row within 5 s of start (pytest with a short-lived `consume_forever` thread).
- [ ] Dashboard shows "No live workers" when the worker is stopped (e2e with the worker not running) and the ETA when it runs.
- [ ] `job.cancel` is refused for RUNNING jobs.

## Files
- `apps/admin/src/app/platform/jobs/page.tsx`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/jobs/page.tsx` (new), `apps/admin/src/lib/jobs.ts` + test (new), `apps/admin/src/app/platform/actions.ts`
- `packages/db/prisma/schema.prisma` (`Job.finishedAt`, `WorkerHeartbeat`) + migration
- `workers/media/hub_worker/jobs.py`, `workers/media/tests/test_jobs.py`

## Verification
```bash
pnpm --filter @hub/admin test
cd workers/media && make test -- -k heartbeat
```

## Notes for agents
First failing test: `summarizeJobs`. Keep the dashboard query count small (one `groupBy`, one raw aggregate); it must stay fast with 100k job rows.
