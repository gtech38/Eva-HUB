---
id: WEB-009
title: Registry page (items, claims, cash fund) and Wedding Party page
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-SITE
---

## Context
`PAGE_PATHS` maps `REGISTRY → /registry` and `WEDDING_PARTY → /party`, the nav in `sites/[slug]/layout.tsx` lists both, but no route exists under `apps/web/src/app/sites/[slug]/` for either, so enabled pages 404. Admin already manages `RegistryItem`, `RegistryClaim` counts and `CashFund` (`events/[eventId]/registry/page.tsx`). docs/02 §4: guests can "Mark registry item purchased"; README: "External links, a cash/honeymoon fund (Stripe or Venmo link), and mark as purchased".

## Scope
- `/registry/page.tsx`: intro from `RegistryContent`, item cards (title via `t()`, store, image, quantity vs claimed), external link opens in new tab with `rel="noopener"`, "Mark as purchased" form → `claimItem(itemId, quantity)` server action creating `RegistryClaim(userId, guestName)`; "Undo" for own claim within 24 h. Cash funds: EXTERNAL shows handle and copy button; STRIPE shows a "Contribute" button disabled with "coming soon" until WEB-025.
- `/party/page.tsx`: `WeddingPartyContent.members` grid (name, role via `t()`, blurb, photo from `photoKey` via `storage.derivativeUrl`), grouped by `role` text; empty state when no members.
- Nav label for Wedding Party via `ui("party", locale)` instead of the hardcoded "Wedding Party" string; add key to `UI` with te/hi.
- Both pages respect `requireViewer()` and `page(site, TYPE)?.enabled`.

## Out of scope
- Stripe contributions (WEB-025). Admin editing of wedding party content (exists via `PageEditor` for `WEDDING_PARTY`).

## Acceptance criteria
- [ ] Claiming an item decrements the shown availability; a second claim beyond `quantity` is refused (vitest with Postgres on the pure availability + action).
- [ ] A claim is tied to the viewer's `userId`; another guest cannot undo it.
- [ ] `/party` renders members in all three themes (visual regression WEB-013 picks it up).
- [ ] e2e: guest marks an item purchased and sees "You purchased this".

## Files
- `apps/web/src/app/sites/[slug]/registry/{page.tsx,actions.ts}`, `apps/web/src/app/sites/[slug]/party/page.tsx` (new)
- `apps/web/src/app/sites/[slug]/layout.tsx`, `packages/shared/src/i18n.ts`, `packages/shared/src/pages.ts`
- Read: `apps/admin/src/app/studios/[studioId]/events/[eventId]/registry/page.tsx`

## Verification
```bash
pnpm --filter @hub/web test
pnpm e2e --grep registry
```

## Notes for agents
First failing test: availability/over-claim rule. `RegistryItem` has no `studioId`; scope through the event via the scoped client (ADM-002) if merged, otherwise filter `where: { eventId }` explicitly.
