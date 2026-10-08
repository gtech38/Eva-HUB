---
id: ADM-021
title: Refunds with entitlement revoke, receipt emails and a ledger page
labels: [type:feature, area:admin, area:shared, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-022, SHR-005]
epic: EPIC-COMMERCE
---

## Context
docs/02 §4: studio owner "Set prices, Stripe, refunds". `OrderStatus.REFUNDED`, `Entitlement.revokedAt` and `MessagePurpose.RECEIPT` exist. Nothing issues refunds, sends receipts or reports revenue.

## Scope
- Admin `/studios/[studioId]/events/[eventId]/orders`: list of orders (status, items, totals, Stripe links), order detail with "Refund" (full or partial amount, reason) → `payments().refund(...)`; webhook `charge.refunded` sets `Order.REFUNDED` (full) and revokes entitlements tied to the order (`revokedAt`); partial refunds keep entitlements; audit `order.refund`.
- Receipts: on `Order.PAID` (all scopes) create `Message(RECEIPT, EMAIL)` to the buyer's primary email and enqueue `SEND_MESSAGE {template: "receipt", orderId}`; template content via SHR-013 (`receipt`, `contribution_receipt`).
- Ledger `/studios/[studioId]/ledger`: per month and per event: gross, Stripe fees (from `balance_transaction` fetched on webhook and stored on `Order.feeCents`), platform fee, refunds, net; CSV export; studio owner only.
- Policy: `orders.refund` action (owner only) with tests.

## Out of scope
- Payouts scheduling (Stripe handles). Tax reporting.

## Acceptance criteria
- [ ] Full refund of an unlock order revokes the `GALLERY_FULLRES` entitlement and the gallery returns to watermarked for guests (vitest with Postgres + webhook handler).
- [ ] Partial refund leaves the entitlement active.
- [ ] Every PAID order produces exactly one RECEIPT message (idempotent on replay).
- [ ] Ledger totals equal the sum of orders in a fixture month (unit test on the aggregation function).

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/orders/{page.tsx,[orderId]/page.tsx,actions.ts}` (new), `apps/admin/src/app/studios/[studioId]/ledger/{page.tsx,export/route.ts}` (new), `apps/admin/src/lib/ledger.ts` + test
- `packages/shared/src/payments/handlers.ts`, `packages/shared/src/policy.ts` + test, `packages/db/prisma/schema.prisma` (`Order.feeCents`, `refundedCents`) + migration

## Verification
```bash
pnpm --filter @hub/admin test && pnpm --filter @hub/shared test
```

## Notes for agents
First failing test: full refund revokes entitlement. Refund amounts are validated server-side against `Order.totalCents - refundedCents`.
