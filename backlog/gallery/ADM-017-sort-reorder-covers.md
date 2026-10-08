---
id: ADM-017
title: EXIF-based sort, manual reorder and album covers
labels: [type:feature, area:admin, area:web, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-017]
epic: EPIC-GALLERY
---

## Context
The worker sets `Photo.sortKey` from EXIF capture time (fallback `createdAt`), and `Album.coverPhotoId` exists but can only be set through the database. Studios curate: drag the hero shot to the front, pick album covers, and fix cameras with wrong clocks.

## Scope
- Admin gallery: per-album photo strip with drag-and-drop reorder (`@dnd-kit`), writing `sortKey` as a lexicographically ordered string between neighbours (fractional indexing, e.g. `a0`, `a0V`) so one move updates one row; "Reset to capture time" rebuilds `sortKey` from `capturedAt`; "Shift album time by ±hh:mm" for camera clock offsets (updates `capturedAt` and `sortKey`).
- "Set as cover" on a photo → `Album.coverPhotoId`; album list shows covers; web `listVisibleAlbums` already prefers `coverPhotoId`.
- Album sort: drag albums to set `Album.sortOrder`.
- All mutations audited (`photo.reorder`, `album.cover`, `album.timeshift`).

## Out of scope
- Guest-side sorting options. Bulk per-photo captions.

## Acceptance criteria
- [ ] Pure `keyBetween(a, b)` unit tests (start, end, middle, dense keys).
- [ ] Moving one photo changes exactly one `sortKey` (vitest with Postgres).
- [ ] Time shift of +1 h updates `capturedAt` and the order for all photos in the album.
- [ ] e2e: set cover, album grid on the guest site shows that photo.

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/{page.tsx,actions.ts,Reorder.tsx}`, `apps/admin/src/lib/sortkey.ts` (new), `apps/admin/src/lib/sortkey.test.ts`
- Read: `workers/media/hub_worker/handlers/process_photo.py` (sortKey format), `apps/web/src/lib/gallery.ts`

## Verification
```bash
pnpm --filter @hub/admin test
pnpm e2e --grep cover
```

## Notes for agents
First failing test: `keyBetween`. The worker writes ISO timestamps as `sortKey`; fractional keys must sort after/before those consistently — simplest is to prefix all keys with the ISO timestamp of the neighbour and append the fraction.
