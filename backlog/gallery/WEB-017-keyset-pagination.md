---
id: WEB-017
title: Keyset pagination and virtualised album grid
labels: [type:feature, area:web, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-GALLERY
---

## Context
`apps/web/src/app/sites/[slug]/gallery/[albumId]/page.tsx` runs `prisma.photo.findMany` with no `take`, then `toPhotoDTOs` presigns two URLs per photo; a 2,000-photo album means 4,000 presigns and a multi-MB HTML payload. docs/03 §3: "Paginate with keyset cursors, not offsets" on `(eventId, albumId, sortKey)`.

## Scope
- `apps/web/src/lib/gallery.ts`: `listAlbumPage(eventId, viewer, albumId, { cursor?: { sortKey, id }, limit = 60 })` using `WHERE (sortKey, id) > (cursor)` ordering `sortKey ASC, id ASC`, returns `{ photos, nextCursor }`; same for "My photos" (`PhotoMatch` ordered by score) and favorites.
- Route handler `GET /api/gallery/[albumId]?cursor=` returning DTOs (visibility + entitlement re-checked), used by the client for subsequent pages; the page server-renders the first page.
- `PhotoGrid` becomes incrementally loadable: `IntersectionObserver` sentinel, append pages, lightbox navigation triggers prefetch of the next page when within 5 of the end; row virtualisation with `@tanstack/react-virtual` for > 300 items (keep a plain grid below).
- `sortKey` null handling: fall back to `createdAt` ISO in the worker already; backfill null `sortKey` in a migration script for existing rows.
- Album count badge from `_count` (already), total shown in the header.

## Out of scope
- Manual reorder (ADM-017). CDN URLs (SHR-008; pagination alone already cuts presigns per request).

## Acceptance criteria
- [ ] Unit test for the cursor encoder/decoder and for `listAlbumPage` paging through 125 fixture photos in pages of 60 with no gaps or duplicates (Postgres).
- [ ] Album page HTML for a 2,000-photo album contains at most 60 `<img>` tags.
- [ ] e2e: scroll to bottom twice, 180 thumbnails rendered, lightbox `ArrowRight` across the page boundary works.
- [ ] `/api/gallery/<albumId>` with a viewer who cannot see HOSTS_ONLY returns none of those photos.

## Files
- `apps/web/src/lib/gallery.ts`, `apps/web/src/lib/gallery.test.ts`, `apps/web/src/app/api/gallery/[albumId]/route.ts` (new)
- `apps/web/src/app/sites/[slug]/gallery/{[albumId]/page.tsx,me/page.tsx,page.tsx}`, `apps/web/src/components/gallery/PhotoGrid.tsx`

## Verification
```bash
pnpm --filter @hub/web test
pnpm e2e --grep pagination
```

## Notes for agents
First failing test: paging without gaps. Cursor = base64url of `${sortKey}|${id}`; validate shape before use. Keep `visiblePhotoWhere` as the single visibility source.
