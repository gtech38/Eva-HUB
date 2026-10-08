---
id: WRK-017
title: Carry eventId/studioId in worker-enqueued job payloads (INDEX_FACES)
labels: [type:feature, area:worker, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [ADM-022]
epic: EPIC-OBS
---

## Context
Found while building ADM-022 (#74): the event jobs view (`/studios/[studioId]/events/[eventId]/jobs`) and its ETA select jobs by `payload->>'eventId'`. Admin-enqueued jobs carry `eventId` (`PROCESS_PHOTO`, `CLUSTER_FACES`, `PURGE_FACE_INDEX`, `FIRE_REMINDER`) and `index_faces.py` enqueues `CLUSTER_FACES` with it, but `process_photo.py` enqueues `INDEX_FACES` with `{"photoId": ...}` only. During a big upload the event view therefore omits every face-indexing job, and the ETA undercounts by roughly half.

## Scope
- `process_photo.py`: enqueue `INDEX_FACES` with `{"photoId", "eventId", "studioId"}` (the photo row already has both).
- Document the payload in `workers/media/README.md` (job table) and note in the `python-media-worker` skill that every job payload should carry `eventId` (and `studioId` when known) so per-event views and logs can scope it.

## Out of scope
- Backfilling payloads of existing rows (they age out); an expression index on `payload->>'eventId'` (only if the event view gets slow; Prisma cannot model it, so it needs a raw migration).

## Acceptance criteria
- [ ] A processed photo's `INDEX_FACES` job has `payload.eventId` and `payload.studioId` equal to the photo's (pytest with the `tenant` fixture and a fake storage).
- [ ] The handler still reads only `photoId` (no behaviour change).

## Files
- `workers/media/hub_worker/handlers/process_photo.py`, `workers/media/tests/test_process_photo.py` (new), `workers/media/README.md`

## Verification
```bash
cd workers/media && .venv/bin/python -m pytest -q tests/test_process_photo.py
```

## Notes for agents
Red first: run the handler on a tenant photo with storage monkeypatched and assert the enqueued `INDEX_FACES` payload.
