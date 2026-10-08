---
id: ADM-019
title: Stripe Connect onboarding for the studio
labels: [type:feature, area:admin, priority:p1, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-009, INF-009]
epic: EPIC-COMMERCE
---

## Context
`Studio.stripeAccountId` exists; docs/01 §8 "Each Studio holds a stripeAccountId, and charges go to the studio's account." The studio settings page has no payments section.

## Scope
- Studio settings "Payments" card: status (not connected / onboarding incomplete / charges enabled / payouts enabled), "Connect with Stripe" button → `createConnectAccountLink` (creates an Express account if `stripeAccountId` is null, stores it, returns to `/studios/<id>/settings?stripe=return`), "Open Stripe dashboard" login link, and a refresh of status via `getAccountStatus`.
- Webhook handler `account.updated` updates a new `Studio.stripeChargesEnabled Boolean` / `stripePayoutsEnabled Boolean` (+ migration) so pages do not call Stripe on render.
- Policy: `studio.manage` only (`can()` already restricts to OWNER). Audit `studio.stripe.connect`.
- Fake provider path: "Connect" immediately marks enabled for local e2e.

## Out of scope
- Platform fee configuration UI (env only). Billing for studios (ADM-025).

## Acceptance criteria
- [ ] Clicking Connect stores `stripeAccountId` and redirects to the account link URL (vitest with fake provider).
- [ ] `account.updated` with `charges_enabled: true` flips the flag (webhook handler unit test).
- [ ] STAFF role cannot see or trigger the card (render test).

## Files
- `apps/admin/src/app/studios/[studioId]/{settings/page.tsx,actions.ts}`, `packages/shared/src/payments/handlers.ts`, `packages/db/prisma/schema.prisma` + migration

## Verification
```bash
pnpm --filter @hub/admin test && pnpm --filter @hub/shared test
```

## Notes for agents
First failing test: STAFF cannot trigger connect. Store only the account id and booleans; never persist Stripe secrets per studio.
