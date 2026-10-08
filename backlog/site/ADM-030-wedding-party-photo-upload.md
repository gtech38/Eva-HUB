---
id: ADM-030
title: Wedding Party member photo upload in the page editor
labels: [type:feature, area:admin, priority:p2, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-009]
epic: EPIC-SITE
---

## Context
WEB-009 renders `WeddingPartyContent.members[].photoKey` on `/party`, but the only way to set it today is to hand-type a storage key into the JSON in the `WEDDING_PARTY` page editor (`events/[eventId]/pages/page.tsx` shows a `photoKey: null` placeholder). The web page only signs keys under `s/{studioId}/e/{eventId}/site/` (`isEventSiteKey` in `apps/web/src/lib/party.ts`; `orig/`, `d/` and `zip/` keys are refused so a page editor cannot expose unentitled photos), so a typo or a key from another event silently shows the initial-letter placeholder instead of a photo.

## Scope
- Add a `keys.partyPhoto(studioId, eventId, rand, ext)` helper in `packages/shared/src/storage.ts` under `s/{studioId}/e/{eventId}/site/party-{rand}.{ext}`.
- In the `WEDDING_PARTY` editor, add a per-member image upload (JPEG/PNG/WebP, ≤ 5 MB) using the existing `/api/upload` proxy, downscale to 800 px on the longest side, and write the resulting key into that member's `photoKey`.
- Reject a saved `photoKey` that is not under the event's own prefix in the admin action's Zod validation, with a field error.
- Audit `event.page.update` as the existing page save already does.

## Out of scope
- A shared image-picker for About/Home (ADM-013 owns hero images). Face-search or gallery integration.

## Acceptance criteria
- [ ] `keys.partyPhoto` returns a key that `isEventSiteKey` accepts for the same studio/event and rejects for another event (unit test).
- [ ] Saving page content with a `photoKey` under a different event's prefix is refused with a field error (unit test on the schema).
- [ ] e2e: upload a 100x100 PNG for a member, open `/party`, the member card shows an `<img>` whose URL responds 200.

## Files
- `packages/shared/src/storage.ts`, `packages/shared/src/pages.ts`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/pages/page.tsx`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `apps/admin/src/app/api/upload/route.ts`
- Read: `apps/web/src/lib/party.ts`, `apps/web/src/app/sites/[slug]/party/page.tsx`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
pnpm e2e --grep "party"
```

## Notes for agents
First failing test: `keys.partyPhoto` round-trips through `isEventSiteKey`. The web side already enforces the `site/` prefix; this ticket makes the admin side produce and validate it (and also reject `orig/`, `d/`, `zip/` keys at save time).
