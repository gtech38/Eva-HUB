---
id: ADM-025
title: Stripe Billing subscriptions, plan limits and usage metering
labels: [type:feature, area:admin, area:worker, area:shared, priority:p3, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [SHR-009, ADM-024]
epic: EPIC-SAAS
---

## Context
docs/04 Phase 3: "studio subscription billing (Stripe Billing), plan limits and usage metering (storage GB, photos, SMS sends)." Payments infrastructure (SHR-009) exists for Connect charges; subscriptions bill the studio itself on the platform account.

## Scope
- `Plan(code, name, priceMonthlyCents, limits: { storageGb, photosPerEvent, eventsActive, smsPerMonth, faceSearch: bool })` seeded; `Studio.planCode`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus` (+ migration).
- Billing page: choose plan → Stripe Checkout (mode subscription) → webhook `customer.subscription.*` updates status; customer portal link for card/cancel.
- Usage metering: daily job `METER_USAGE` (scheduler WRK-012): per studio compute storage bytes (sum `Photo.originalBytes` + derivative estimate or S3 `ListObjectsV2` by prefix with size), photos per event, SMS sent this month (`Message` rows) → `UsageSnapshot(studioId, date, ...)`; report overage via Stripe usage records for metered items (SMS) when the plan is metered.
- Enforcement points with friendly errors: `beginUpload` (photo/storage limits), `createEvent` (active events), `sendMessage` (SMS cap → `SUPPRESSED` with reason `plan_limit`), face search toggle (plan without faces). Platform admin can override per studio (`Studio.limitOverridesJson`), audited.
- Grace: `past_due` keeps read access, blocks uploads/sends after 7 days.

## Out of scope
- Invoicing PDFs (Stripe does it). Tax.

## Acceptance criteria
- [ ] `enforceLimit(studio, "photosPerEvent", current)` unit tests incl. override.
- [ ] Upload beyond the plan returns a `plan_limit` error state (vitest with Postgres).
- [ ] `METER_USAGE` writes one snapshot per studio per day; rerun is idempotent (pytest).
- [ ] Subscription webhook moves `subscriptionStatus` and a `past_due` studio older than 7 days is blocked from uploads (vitest).

## Files
- `packages/shared/src/plans.ts` + test (new), `packages/shared/src/payments/handlers.ts`, `packages/db/prisma/schema.prisma` + migration + seed
- `apps/admin/src/app/studios/[studioId]/billing/{page.tsx,actions.ts}` (new), `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/actions.ts`, `apps/admin/src/app/studios/[studioId]/actions.ts`
- `workers/media/hub_worker/handlers/meter_usage.py`, `workers/media/hub_worker/scheduler.py`, tests

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
cd workers/media && make test -- -k meter
```

## Notes for agents
First failing test: `enforceLimit`. Limits are read from the DB plan row, never hardcoded in UI.
