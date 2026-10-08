---
id: WRK-012
title: Scheduler tick: face-index purges, face-profile 3-year purge, housekeeping jobs
labels: [type:feature, area:worker, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-FACE
---

## Context
`Event.faceIndexPurgeAt` is computed when the gallery is published, and `PURGE_FACE_INDEX {eventId}` works, but nothing enqueues it when the date passes; `purgeFaceIndexNow` in admin is manual. `FaceProfile.purgeAfter` is never consulted. docs/01 §2: "Scheduler: a job.run_at column plus a 1-minute tick in the worker — covers SMS reminders and retention purges without a cloud cron." The CUBI position (docs/01 §6) depends on purges actually happening.

## Scope
- `hub_worker/scheduler.py`: `tick(conn)` runs from `consume_forever`'s housekeeping branch every 60 s (already has a 60 s cadence) and uses `dedupe_key` so multiple workers do not duplicate:
  - `SELECT id FROM "Event" WHERE "faceIndexPurgeAt" <= now() AND "faceIndexPurgedAt" IS NULL` → `enqueue PURGE_FACE_INDEX {eventId}` with `dedupe_key purge:<eventId>`.
  - Daily (`dedupe_key tick:daily:<date>`): `PURGE_FACE_PROFILES`, `CLEAN_MULTIPART {olderThanHours: 24}` (WRK-005), `EXPIRE_ZIPS` sweep (WRK-007).
- New handler `purge_face_profiles.py`: delete `FaceProfile WHERE "purgeAfter" <= now()` and set `BiometricConsent.revokedAt` for their consents; audit `faceprofile.purge` with count (no user ids in `data` beyond count); also delete profiles whose consent was revoked but row remains (defensive).
- `PURGE_FACE_INDEX`: after purge, if photos are later re-indexed (admin "Re-index"), `faceIndexPurgedAt` must be cleared and `faceIndexPurgeAt` recomputed — handle in admin `reindexFaces` (set `faceIndexPurgedAt = null`, recompute from `galleryPublishedAt`/retention) and audit.
- Admin event settings shows "Next purge: <date> (scheduler)" and the platform jobs page shows the last tick time (store in a `WorkerHeartbeat(workerId, lastTickAt)` table, or reuse `Job` rows with type `TICK`).
- pytest: event past purge date gets exactly one purge job across two tick calls; profile past `purgeAfter` deleted; profile not yet due untouched.

## Out of scope
- Reminder scheduling (already uses `runAt`). Retention reporting UI beyond the dates above.

## Acceptance criteria
- [ ] Two consecutive `tick()` calls on an overdue event create one `PURGE_FACE_INDEX` job.
- [ ] `purge_face_profiles` deletes due profiles and audits the count; not-due ones remain.
- [ ] Admin re-index after purge resets `faceIndexPurgedAt` and sets a new `faceIndexPurgeAt` (vitest with Postgres).
- [ ] Worker README documents the tick and the daily jobs.

## Files
- `workers/media/hub_worker/scheduler.py` (new), `workers/media/hub_worker/jobs.py`, `workers/media/hub_worker/handlers/purge_face_profiles.py` (new), `workers/media/tests/test_scheduler.py` (new), `workers/media/README.md`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/{actions.ts,settings/page.tsx}`, `apps/admin/src/app/platform/jobs/page.tsx`

## Verification
```bash
cd workers/media && make test -- -k scheduler
pnpm --filter @hub/admin test
```

## Notes for agents
First failing test: single purge job across two ticks. Keep `tick()` cheap: indexed queries only; it runs every minute on every worker replica.
