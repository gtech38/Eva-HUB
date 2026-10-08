---
id: WEB-019
title: Proofing lists: host selection with limits and submit lock, admin view and export
labels: [type:feature, area:web, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-017]
epic: EPIC-GALLERY
---

## Context
`ProofingList(eventId, name, maxSelections, lockedAt, photoIds[], createdByUserId)` exists in the schema and `proofing.edit` in the policy (hosts only; studio views), but there is no UI anywhere. docs/04 Phase 2: "Proofing lists with selection limits and a submit to studio lock."

## Scope
- Guest site (hosts/co-hosts): `/gallery/proofing` lists the host's lists; create (name, optional limit); a "Select for <list>" mode in `PhotoGrid` toggles membership with a counter `12 / 40`; refuse beyond `maxSelections`; reorder within the list by drag (optional) or move up/down; "Submit to studio" sets `lockedAt`, after which edits are refused and the UI is read-only; audit `proofing.submit`.
- Admin gallery page: "Proofing" tab showing each list, status, selection thumbnails, CSV/TXT export of filenames (for Lightroom import), and "Unlock" (studio only, audited).
- Server actions re-check `proofing.edit`, visibility (`visiblePhotoWhere`) of every photo id added, and `lockedAt`.
- Add `studioId` to `ProofingList` for tenancy consistency (+ migration) and `updatedAt` already exists.

## Out of scope
- Guest (non-host) proofing. Lab ordering from a list (EPIC-COMMERCE).

## Acceptance criteria
- [ ] Adding the 41st photo to a 40-limit list is refused with a reason (vitest with Postgres).
- [ ] After `submit`, `addToList` returns `locked` and the DB is unchanged.
- [ ] A hidden photo cannot be added even if its id is known.
- [ ] e2e: host creates a list, selects 3 photos, submits; admin sees the list and downloads the filename export.

## Files
- `apps/web/src/app/sites/[slug]/gallery/proofing/{page.tsx,actions.ts}` (new), `apps/web/src/components/gallery/PhotoGrid.tsx`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/{page.tsx,proofing/export/route.ts}`
- `packages/db/prisma/schema.prisma` + migration `proofing_studio_id`

## Verification
```bash
pnpm --filter @hub/web test && pnpm --filter @hub/admin test
pnpm e2e --grep proofing
```

## Notes for agents
First failing test: limit enforcement. Store `photoIds` ordered; validate as a set on write to prevent duplicates.
