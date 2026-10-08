---
id: SHR-009
title: PaymentProvider interface, Stripe adapter and idempotent webhook event store
labels: [type:feature, area:shared, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [INF-008]
epic: EPIC-COMMERCE
---

## Context
docs/01 §2: payments are "built against Stripe directly, behind a thin interface". All later commerce tickets need: create a Checkout session on a connected account, verify webhooks, and process each event exactly once.

## Scope
- `packages/shared/src/payments.ts`: `interface PaymentProvider { createCheckout(input): Promise<{ id, url }>; refund(paymentIntentId, amountCents?): Promise<void>; constructWebhookEvent(rawBody, signature): WebhookEvent; createConnectAccountLink(studio): Promise<{ url }>; getAccountStatus(accountId) }`; `StripeProvider` using the `stripe` SDK with `stripeAccount` header for Connect (destination charges with `application_fee_amount` from `PLATFORM_FEE_BPS` env, default 0); `FakePaymentProvider` used when `!stripeEnabled()` that returns a local URL `/dev/checkout/<id>` which immediately "pays" (for e2e without Stripe).
- Webhook route `apps/web/src/app/api/stripe/webhook/route.ts`: raw body, signature check, insert into `WebhookEvent(id = stripe event id PK, type, payload, receivedAt, processedAt)` (+ migration) with `ON CONFLICT DO NOTHING` → if already processed return 200; dispatch by type to handlers registered in `packages/shared/src/payments/handlers.ts` (`checkout.session.completed`, `charge.refunded`, `account.updated`); mark processed; failures return 500 so Stripe retries.
- `Order` creation helper `createOrder({ studioId, eventId, userId, items })` computing totals from `Product.priceCents` server-side (never trust client prices).
- Unit tests with Stripe's test signing: `constructWebhookEvent` rejects a bad signature; duplicate event id processed once; `FakePaymentProvider` flow.

## Out of scope
- Specific products' handlers (WEB-022, WEB-024, WEB-025 register theirs). Connect UI (ADM-019).

## Acceptance criteria
- [ ] Webhook with invalid signature → 400 and no `WebhookEvent` row.
- [ ] Same event delivered twice → handler runs once (vitest with Postgres).
- [ ] `createOrder` totals come from DB prices; a tampered client total is ignored (unit test).
- [ ] With the placeholder key, `payments()` returns the fake provider and no network call occurs (assert `stripe` constructor not called).

## Files
- `packages/shared/src/payments.ts`, `packages/shared/src/payments/{stripe,fake,handlers}.ts`, `packages/shared/src/payments.test.ts` (new)
- `apps/web/src/app/api/stripe/webhook/route.ts` (new), `apps/web/src/app/dev/checkout/[id]/route.ts` (fake, dev only)
- `packages/db/prisma/schema.prisma` (WebhookEvent) + migration

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
stripe trigger checkout.session.completed   # with INF-008 running
```

## Notes for agents
First failing test: duplicate event processed once. Next.js route must read `await req.text()` before any JSON parsing for signature verification. The fake provider must be unreachable in production (`NODE_ENV === "production"` → throw if Stripe disabled and a checkout is attempted).
