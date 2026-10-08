---
id: WEB-022
title: GALLERY_UNLOCK checkout for hosts → webhook → entitlement
labels: [type:feature, area:web, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-009, ADM-019]
epic: EPIC-COMMERCE
---

## Context
docs/01 §8: "After the host pays for the package (the GALLERY_UNLOCK product): a GALLERY_FULLRES entitlement with userId = null unlocks clean images, single downloads and zips for every invited guest." Phase 1 ships the manual comped unlock (`grantGalleryUnlock`); this replaces it for paying hosts "without changing the gallery code" (`isEntitledFullRes` already keys off the entitlement).

## Scope
- Admin: event settings "Gallery package" card: pick the `GALLERY_UNLOCK` product from the studio's price sheet (or none = comp only); shows locked/unlocked state and the order if paid.
- Guest site (hosts/co-hosts only, policy `registry.manage`-like: add `gallery.purchase` action to `can()` with a policy test): banner on `/gallery` when locked: "Unlock the full gallery for all guests — $X" → `startGalleryUnlock()` creates `Order(PENDING)` + Checkout session (`createCheckout`) with `metadata { orderId, eventId, scope: "GALLERY_UNLOCK" }`, redirects; success/cancel return URLs on the event site.
- Webhook handler `checkout.session.completed` (registered in SHR-009 handlers): verify `metadata.orderId`, set `Order.status = PAID`, `stripePaymentIntentId`, create `Entitlement(GALLERY_FULLRES, userId null, orderId)` in one transaction; idempotent (unique `orderId` on Entitlement or check-before-insert); audit `entitlement.grant.paid`; enqueue receipt (ADM-021).
- `DIGITAL_PHOTO` single-photo purchase: modelled but **off by default** (feature flag `ENABLE_DIGITAL_PHOTO=false`); when on, a per-photo "Buy full-res" in the lightbox creates `Entitlement(PHOTO_FULLRES, userId, photoId)`. Implement the handler path and flag only; UI minimal.
- Admin `revokeGalleryUnlock` refuses to revoke a paid entitlement unless the order is refunded (ADM-021).

## Out of scope
- Refund (ADM-021). Prints (WEB-024).

## Acceptance criteria
- [ ] Policy test: guests cannot `gallery.purchase`; hosts and co-hosts can; INVITE_LINK sessions cannot.
- [ ] Completing checkout (fake provider in e2e) flips the gallery to unlocked for a different guest's session within one reload.
- [ ] Replayed `checkout.session.completed` creates no second entitlement (vitest with Postgres).
- [ ] With the real Stripe test mode and `stripe trigger`, the order becomes PAID (manual, documented).

## Files
- `packages/shared/src/policy.ts`, `packages/shared/src/policy.test.ts`, `packages/shared/src/payments/handlers.ts`
- `apps/web/src/app/sites/[slug]/gallery/{page.tsx,purchase/actions.ts}` (new), `apps/web/src/components/gallery/UnlockBanner.tsx` (new)
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/{settings/page.tsx,gallery/actions.ts}`
- `packages/db/prisma/schema.prisma` (unique `Entitlement.orderId` or composite) + migration

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
pnpm e2e --grep unlock
```

## Notes for agents
First failing test: the policy row. Keep `isEntitledFullRes` untouched; the ticket's success criterion is that gallery code does not change.
