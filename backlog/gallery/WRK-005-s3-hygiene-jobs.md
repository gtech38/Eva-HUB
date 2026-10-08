---
id: WRK-005
title: S3 hygiene jobs: rotate derivatives on hide, delete objects on photo delete, abort stale multipart uploads
labels: [type:feature, area:worker, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [SHR-007]
epic: EPIC-GALLERY
---

## Context
docs/01 §5: "Hiding a photo or album removes it from listings immediately. The derivative key is also rotated, so a URL that was already shared stops working." `setPhotoHidden` only flips the flag; `deletePhoto` leaves originals and derivatives in the bucket (TODO in `gallery/actions.ts`); multipart uploads abandoned by the browser are never aborted and cost storage.

## Scope
- New job types `ROTATE_DERIVATIVES {photoId}`, `DELETE_PHOTO_OBJECTS {studioId, eventId, photoId, keys[]}`, `CLEAN_MULTIPART {olderThanHours}`; add to `JobType` in `packages/db/src/index.ts`, `JOB_TYPES` in `jobs.py`, and `default_handlers()`.
- `rotate_derivatives.py`: copy each derivative to a new key with a fresh random suffix (`storage.keys.derivative` already randomises), update `Photo.derivatives` atomically, delete old keys; also enqueued for every photo when an album becomes `HIDDEN`/`HOSTS_ONLY` (`saveAlbum` visibility change) with `dedupe_key rotate:<photoId>`.
- `delete_photo_objects.py`: deletes listed keys (originals + derivatives) with `delete_objects` batches; tolerant of missing keys; audits `photo.objects.deleted`.
- `clean_multipart.py`: `listMultipartUploads` under `s/` older than 24 h → abort; also deletes `Photo(UPLOADING)` rows older than 24 h with no object; scheduled by the daily tick (WRK-012 adds the tick; until then, enqueue from admin "Clean up" button on the gallery page).
- Admin: `setPhotoHidden(hidden=true)` enqueues ROTATE; `deletePhoto` deletes the row (cascades Face/Favorite/PhotoMatch) and enqueues DELETE with the keys captured before deletion; album visibility change enqueues ROTATE for its photos.
- pytest for each handler against RustFS (skip when unreachable).

## Out of scope
- CDN cache purge (SHR-008 adds a hook; rotation makes old URLs 404 at origin regardless).

## Acceptance criteria
- [ ] After hide, the old thumb URL returns 403/404 and the new `Photo.derivatives.thumb` key differs and exists (pytest).
- [ ] After delete, `headObject` is null for original and all derivatives (pytest) and no `Photo` row remains.
- [ ] An abandoned multipart upload older than 24 h is aborted; a fresh one is left alone (pytest with mocked age or `olderThanHours=0`).
- [ ] Admin actions enqueue the jobs in the same transaction as the row change (vitest with Postgres).

## Files
- `workers/media/hub_worker/handlers/{rotate_derivatives,delete_photo_objects,clean_multipart}.py` (new), `workers/media/hub_worker/jobs.py`, `workers/media/hub_worker/storage.py`, `workers/media/tests/test_hygiene.py` (new)
- `packages/db/src/index.ts`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/actions.ts`

## Verification
```bash
cd workers/media && make test -- -k hygiene
pnpm --filter @hub/admin test
```

## Notes for agents
First failing test: rotate changes the key and the old one is gone. `Face` rows reference the photo, not derivative keys, so rotation does not touch the face index.
