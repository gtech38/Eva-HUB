---
id: WRK-020
title: INDEX_FACES must not rebuild a purged index; disabling face search purges it
labels: [type:bug, area:worker, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-FACE
---

## Context
Found while writing the LEG-005 compliance checklist (docs/compliance/biometrics.md, gap G4). `INDEX_FACES` selects `Event.faceIndexPurgedAt` but never uses it, and `PROCESS_PHOTO` enqueues `INDEX_FACES` for every photo it finishes. A photo uploaded or reprocessed after a `PURGE_FACE_INDEX` is embedded again, and the event keeps its old, already-past purge date, so the face data is back with no way to be purged on schedule. Separately, unticking "Face search enabled" makes `INDEX_FACES` and search stop but leaves every existing embedding in place, which a host or studio will reasonably read as "face search is off for this event".

Two more holes found in review. `PURGE_FACE_INDEX` races with work in flight: an `INDEX_FACES` that is RUNNING when the purge commits inserts its `Face` rows afterwards, and queued `faces:{photoId}` jobs are not removed by the purge (only `cluster:{eventId}` is). And `CLUSTER_FACES` selects `Event.faceSearchEnabled` and never uses it, so a disabled event is still clustered and `_match_profiles` keeps writing `PROFILE_AUTO` matches for existing profiles.

## Scope
- `hub_worker/handlers/index_faces.py`: when `Event.faceIndexPurgedAt IS NOT NULL`, log and return without writing `Face` rows (same pattern as the existing `faceSearchEnabled` skip).
- Close the race: in `index_faces`, re-check `faceIndexPurgedAt` and `faceSearchEnabled` inside the write transaction after taking `SELECT ... FROM "Event" WHERE id = %s FOR SHARE`; `purge_face_index` already takes `FOR UPDATE` on the same row, so one of them waits for the other. Make `purge_face_index` also delete queued (not running) `INDEX_FACES` jobs for the event's photos (dedupe keys `faces:{photoId}`).
- Dead jobs: `purge_face_index` also deletes the event's DEAD `INDEX_FACES` rows (and DEAD `PROCESS_PHOTO` rows only while face search is being turned off), because the admin jobs page's "Retry dead" revives every dead job of a type across all events and would rebuild a purged index. Until then the runbook (1.4) tells operators to delete them by SQL.
- `hub_worker/handlers/cluster_faces.py`: return without clustering or profile matching when `faceSearchEnabled` is false; `_match_profiles` skips guests with `Guest.faceSearchOptOut` (it joins `Guest` but ignores the flag, so an opted-out guest's `PROFILE_AUTO` matches are recreated on the next run, undoing an operator's event-scoped delete).
- Admin `updateEventSettings`: when `faceSearchEnabled` changes from true to false, enqueue `PURGE_FACE_INDEX {eventId}` (dedupe key as in `purgeFaceIndexNow`) and audit `faceindex.purge.request` with `data: { reason: "face-search-disabled" }`.
- Update `docs/compliance/biometrics.md` (G4, C6, C11, L11) and the runbook step 1.1 to match.

## Out of scope
- A "re-index" action that clears `faceIndexPurgedAt` and recomputes `faceIndexPurgeAt` (WRK-012 owns that).
- The scheduler (WRK-012) and the unpublished-event purge date (WRK-021).

## Acceptance criteria
- [ ] `INDEX_FACES` for a photo whose event has `faceIndexPurgedAt` set writes no `Face` rows and does not set `Photo.facesIndexedAt`.
- [ ] Without `faceIndexPurgedAt`, indexing is unchanged.
- [ ] An `INDEX_FACES` whose event is purged (or has face search turned off) between its start and its write writes no `Face` rows (test by running the purge between the handler's read and write, for example with a hook on the connection or a second connection holding the event row).
- [ ] After a purge, no queued `INDEX_FACES` job for the event's photos remains; a RUNNING one is not touched.
- [ ] After a purge, no DEAD `INDEX_FACES` job for the event's photos remains, and DEAD jobs of other events are untouched.
- [ ] `CLUSTER_FACES` on an event with face search off creates no clusters and writes no `PhotoMatch`.
- [ ] `_match_profiles` writes no `PROFILE_AUTO` match for a guest with `faceSearchOptOut = true`.
- [ ] Saving event settings with face search turned off queues exactly one `PURGE_FACE_INDEX` job and one `faceindex.purge.request` audit row; saving with it already off, or turning it on, queues none.

## Files
`workers/media/hub_worker/handlers/{index_faces,purge_face_index,cluster_faces}.py`, `workers/media/tests/` (extend `test_purge_face_index.py`) (new `test_index_faces.py` or extend the face tests), `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `docs/compliance/{biometrics.md,runbook-biometric-deletion.md}`

## Verification
```bash
cd workers/media && .venv/bin/python -m pytest -q tests/ -k index_faces
pnpm --filter @hub/admin test
node scripts/compliance/verify-purge.mjs <eventId> --database <hub_tN>   # still PASS after a post-purge upload is processed
```

## Notes for agents
Red first: seed an event with `faceIndexPurgedAt` set and a READY photo, run the handler, assert zero `Face` rows (the model-backed path needs `make models`; stub `face.detect`/`face.embed` if the ONNX files are absent). Lift the admin decision ("did face search just go from on to off?") into a pure function in `lib/` and test it there; the action stays thin.
