---
id: WRK-007
title: BUILD_ZIP scope hashing, invalidation on change, and ready notice
labels: [type:feature, area:worker, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [WEB-018, SHR-005]
epic: EPIC-GALLERY
---

## Context
docs/01 §5: "Built zips are cached until the next upload or visibility change." With WEB-018 the web reuses `ZipExport(READY)` by `scopeHash`, which already changes when the visible set changes; stale archives still occupy storage, and the requester is not told when the zip is ready.

## Scope
- `build_zip.py`: on completion insert `Message(purpose: GALLERY_READY, channel EMAIL)` for `requestedByUserId`'s primary verified email and enqueue `SEND_MESSAGE {messageId, template: "zip_ready", zipExportId}`; set `completedAt`.
- New handler `EXPIRE_ZIPS {eventId}`: marks `ZipExport` rows whose `scopeHash` no longer matches the current visible set as `EXPIRED` (add to status strings) and deletes their part objects after a 7-day grace (so in-flight downloads finish); enqueued with `dedupe_key expire-zips:<eventId>` (+10 min) from `process_photo.py` on READY and from admin hide/unhide/album visibility actions.
- `BUILD_ZIP` verifies the photo set still matches `scopeHash` before marking READY; if not, marks `EXPIRED` and lets the UI re-request.
- pytest: hash mismatch → EXPIRED; message + job created on success; expire handler deletes parts after grace (grace configurable, 0 in tests).

## Out of scope
- Rendering the email (SHR-013 template `zip_ready`).

## Acceptance criteria
- [ ] Completing a zip writes one `GALLERY_READY` message and one `SEND_MESSAGE` job for the requester.
- [ ] Hiding a photo after a zip is READY causes `EXPIRE_ZIPS` to mark it EXPIRED; a new request builds a fresh archive.
- [ ] Expired parts are deleted from the bucket after the grace period.

## Files
- `workers/media/hub_worker/handlers/{build_zip,expire_zips}.py`, `workers/media/hub_worker/jobs.py`, `workers/media/tests/test_zip.py` (new)
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/actions.ts` (enqueue EXPIRE_ZIPS)

## Verification
```bash
cd workers/media && make test -- -k zip
```

## Notes for agents
First failing test: hash mismatch → EXPIRED. Compute `scopeHash` in Python exactly as the TS side does (sorted ids joined by `\n`, sha256 hex); add a cross-language fixture file with a known hash.
