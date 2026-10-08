---
id: WEB-024
title: Print store: price sheet mapping, crop UI, cart and checkout
labels: [type:feature, area:web, area:admin, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-022]
epic: EPIC-COMMERCE
---

## Context
docs/01 §8 "Prints: PriceSheet → Product (print sizes and finishes, mapped to lab SKUs). After payment, a PRINT_SUBMIT job sends the order to the lab adapter." Admin `pricing/page.tsx` manages products with `labSku`. Guests can buy prints before or after the unlock.

## Scope
- Admin: extend `Product` with `attributesJson` (`{ widthIn, heightIn, finish }`) and `active`; price sheet assignment per event (`Event.priceSheetId String?` + migration; default = studio's first sheet); shipping flat rate per sheet (`PriceSheet.shippingCents`).
- Guest lightbox: "Order print" → size picker (products of kind PRINT) → crop UI (`react-easy-crop` or a small custom one) constrained to the print aspect ratio, storing `cropJson { x, y, w, h }` normalised and a `dpi` warning when the original is too small (`Photo.width/height` vs inches × 150); add to cart (client state persisted in `localStorage` per event).
- Cart page `/gallery/cart`: lines, quantities, shipping address form (zod), total computed server-side in `createOrder`; checkout via `createCheckout` with `shipping_address_collection` or our own address in `Order.shippingJson`; success page.
- Webhook: `checkout.session.completed` for `scope: "PRINT"` → `Order.PAID`, enqueue `PRINT_SUBMIT {orderId}` (WRK-014), receipt (ADM-021).
- Watermark is never applied to print files; the lab receives originals via presigned GET (WRK-014).

## Out of scope
- Lab adapter (WRK-014). Tax calculation (note Stripe Tax as a follow-up).

## Acceptance criteria
- [ ] `cropJson` validation rejects crops outside 0..1 and wrong aspect (unit test).
- [ ] DPI warning appears for a 1200×800 photo on an 8×10 print and not on a 4×6 (unit test on the pure function).
- [ ] e2e (fake provider): add two prints, checkout, order PAID, one `PRINT_SUBMIT` job queued.
- [ ] Order total equals sum(product price × qty) + shipping from the DB regardless of client payload (vitest).

## Files
- `apps/web/src/app/sites/[slug]/gallery/cart/{page.tsx,actions.ts}` (new), `apps/web/src/components/gallery/{PhotoGrid.tsx,PrintDialog.tsx,CropTool.tsx}`, `apps/web/src/lib/prints.ts` (new) + tests
- `apps/admin/src/app/studios/[studioId]/pricing/page.tsx`, `apps/admin/src/app/studios/[studioId]/actions.ts`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/settings/page.tsx`
- `packages/db/prisma/schema.prisma` + migration `print_products`, `packages/shared/src/payments/handlers.ts`

## Verification
```bash
pnpm --filter @hub/web test && pnpm --filter @hub/admin test
pnpm e2e --grep print
```

## Notes for agents
First failing test: DPI warning function. Keep the crop tool dependency-light; a canvas-based component is fine if `react-easy-crop` is avoided.
