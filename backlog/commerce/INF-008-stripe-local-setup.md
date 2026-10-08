---
id: INF-008
title: Stripe test-mode local setup with `stripe listen` in docker compose
labels: [type:chore, area:infra, priority:p1, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-COMMERCE
---

## Context
docs/01 §2: "Local development runs as one docker compose stack: ... and `stripe listen` for webhooks." `.env.example` has placeholder Stripe keys and `infra/docker-compose.yml` has no Stripe CLI service. Without this, every commerce ticket would improvise its own webhook testing.

## Scope
- `infra/docker-compose.yml`: optional profile `stripe` with service `stripe-cli` (`stripe/stripe-cli`) running `listen --forward-to http://host.docker.internal:3000/api/stripe/webhook --forward-connect-to http://host.docker.internal:3000/api/stripe/webhook` using `STRIPE_API_KEY` from env; prints the signing secret to logs.
- `pnpm infra:up:stripe` script; `.env.example` gains `STRIPE_PUBLISHABLE_KEY`, keeps `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` placeholders, and documents how to copy the `whsec_` from the CLI logs.
- `packages/shared/src/env.ts`: optional Stripe keys with a derived `stripeEnabled()` = secret starts with `sk_test_`/`sk_live_` and is not the placeholder.
- `docs/deploy/stripe-local.md`: steps, test card numbers, how to trigger `stripe trigger checkout.session.completed`.
- Install `stripe` SDK in `packages/shared` (pinned API version constant).

## Out of scope
- Any charge logic (SHR-009+).

## Acceptance criteria
- [ ] `pnpm infra:up:stripe` starts the CLI container when `STRIPE_API_KEY` is set and logs a `whsec_` secret; without the key the default `pnpm infra:up` is unaffected.
- [ ] `stripeEnabled()` is false with the placeholder key (unit test).
- [ ] `stripe trigger payment_intent.succeeded` reaches `http://localhost:3000/api/stripe/webhook` (a temporary 200 route is acceptable in this ticket; SHR-009 replaces it) — documented, verified manually.

## Files
- `infra/docker-compose.yml`, `.env.example`, `package.json`, `packages/shared/src/env.ts`, `packages/shared/src/env.test.ts`, `docs/deploy/stripe-local.md` (new)

## Verification
```bash
STRIPE_API_KEY=sk_test_... pnpm infra:up:stripe && docker compose -f infra/docker-compose.yml logs stripe-cli | grep whsec
pnpm --filter @hub/shared test
```

## Notes for agents
First failing test: `stripeEnabled()` on the placeholder. Never commit a real key; the CLI reads it from the shell env only.
