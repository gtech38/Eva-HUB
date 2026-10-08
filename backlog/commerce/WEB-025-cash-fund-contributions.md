---
id: WEB-025
title: Cash fund contributions via Stripe Checkout
labels: [type:feature, area:web, priority:p2, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-022, WEB-009]
epic: EPIC-COMMERCE
---

## Context
`CashFund(kind: STRIPE | EXTERNAL)` and `Contribution(stripePaymentIntentId @unique)` exist; WEB-009 renders funds with a disabled "Contribute" for STRIPE kind. docs/01 §8: "Either a Stripe Payment Link or Checkout session (recorded as a Contribution), or a plain Venmo or Zelle handle."

## Scope
- Registry page: for `kind: STRIPE` funds, amount presets + custom amount, optional name and message, "Contribute" → `createCheckout` (mode payment, destination = studio's connected account? No: funds go to the hosts, not the studio — document the decision: contributions are collected on the **studio's** connected account and paid out to the host off-platform, OR funds are not supported until hosts can connect their own Stripe account. Implement option A with a clear note shown to hosts in admin, and a `CashFund.payoutNote` text field for the studio).
- Webhook `checkout.session.completed` with `scope: "CONTRIBUTION"` → `Contribution` row (idempotent on `stripePaymentIntentId`), audit `fund.contribution`.
- Progress bar vs `goalCents` (hide amounts if `showProgress` false — add boolean, default true); hosts see the contributor list in admin registry page; guests see only the progress.
- Receipt email via ADM-021 template `contribution_receipt`.

## Out of scope
- Host-owned Stripe accounts (would need a second Connect flow; note as Phase 3 question).

## Acceptance criteria
- [ ] Replayed webhook creates one `Contribution` (unique PI id) (vitest).
- [ ] Guest view never renders contributor names (render test); admin view does.
- [ ] e2e (fake provider): contribute $50, progress bar updates.

## Files
- `apps/web/src/app/sites/[slug]/registry/{page.tsx,actions.ts}`, `packages/shared/src/payments/handlers.ts`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/registry/page.tsx`
- `packages/db/prisma/schema.prisma` (`CashFund.showProgress`, `payoutNote`) + migration

## Verification
```bash
pnpm --filter @hub/web test
pnpm e2e --grep contribute
```

## Notes for agents
First failing test: idempotent contribution. Record the payout-destination decision in `docs/adr/` (DOC-010 template) in the same PR.
