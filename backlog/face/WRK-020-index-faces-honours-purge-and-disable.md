---
id: WRK-020
title: INDEX_FACES must not rebuild a purged index; disabling face search purges it
labels: [type:bug, area:worker, area:admin, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-FACE
---

## Context
Found while writing the LEG-005 compliance checklist (docs/compliance/biometrics.md, gap G4). `INDEX_FACES` selects `Event.faceIndexPurgedAt` but never uses it, and `PROCESS_PHOTO` enqueues `INDEX_FACES` for every photo it finishes. A photo uploaded or reprocessed after a `PURGE_FACE_INDEX` is embedded again, and the event keeps its old, already-past purge date, so the face data is back with no way to be purged on schedule. Separately, unticking "Face search enabled" makes `INDEX_FACES` and search stop but leaves every existing embedding in place, which a host or studio will reasonably read as "face search is off for this event".

## Scope
- `hub_worker/handlers/index_faces.py`: when `Event.faceIndexPurgedAt IS NOT NULL`, log and return without writing `Face` rows (same pattern as the existing `faceSearchEnabled` skip).
- Admin `updateEventSettings`: when `faceSearchEnabled` changes from true to false, enqueue `PURGE_FACE_INDEX {eventId}` (dedupe key as in `purgeFaceIndexNow`) and audit `faceindex.purge.request` with `data: { reason: "face-search-disabled" }`.
- Update `docs/compliance/biometrics.md` (G4, C6, C11, L11) and the runbook step 1.1 to match.

## Out of scope
- A "re-index" action that clears `faceIndexPurgedAt` and recomputes `faceIndexPurgeAt` (WRK-012 owns that).
- The scheduler (WRK-012) and the unpublished-event purge date (WRK-021).

## Acceptance criteria
- [ ] `INDEX_FACES` for a photo whose event has `faceIndexPurgedAt` set writes no `Face` rows and does not set `Photo.facesIndexedAt`.
- [ ] Without `faceIndexPurgedAt`, indexing is unchanged.
- [ ] Saving event settings with face search turned off queues exactly one `PURGE_FACE_INDEX` job and one `faceindex.purge.request` audit row; saving with it already off, or turning it on, queues none.

## Files
`workers/media/hub_worker/handlers/index_faces.py`, `workers/media/tests/` (new `test_index_faces.py` or extend the face tests), `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `docs/compliance/{biometrics.md,runbook-biometric-deletion.md}`

## Verification
```bash
cd workers/media && .venv/bin/python -m pytest -q tests/ -k index_faces
pnpm --filter @hub/admin test
node scripts/compliance/verify-purge.mjs <eventId> --database <hub_tN>   # still PASS after a post-purge upload is processed
```

## Notes for agents
Red first: seed an event with `faceIndexPurgedAt` set and a READY photo, run the handler, assert zero `Face` rows (the model-backed path needs `make models`; stub `face.detect`/`face.embed` if the ONNX files are absent). Lift the admin decision ("did face search just go from on to off?") into a pure function in `lib/` and test it there; the action stays thin.
