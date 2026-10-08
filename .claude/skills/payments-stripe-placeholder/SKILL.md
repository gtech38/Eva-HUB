---
name: payments-stripe-placeholder
description: Use when touching commerce: PriceSheet/Product/Order/OrderItem/Entitlement/Contribution models, the comped "Unlock gallery" entitlement in admin, entitlement checks in apps/web/src/lib/gallery.ts, STRIPE_* env placeholders, or when starting the planned Stripe Connect integration (docs/01 §8) with stripe listen locally. Stripe is NOT integrated yet; this skill says what exists and how to add it safely.
---

# Payments (Stripe placeholder)

## When this applies
- Anything that decides whether a viewer sees clean images or can download.
- Price sheets and products in admin.
- Starting the Stripe Connect / Checkout work.

## Where things live (what exists today)

| Piece | Where | State |
|---|---|---|
| Models | `packages/db/prisma/schema.prisma`: `PriceSheet`, `Product` (`kind` GALLERY_UNLOCK / DIGITAL_PHOTO / PRINT, `priceCents`, `labSku`), `Order` (`stripeCheckoutId @unique`, `stripePaymentIntentId`), `OrderItem`, `Entitlement` (`scope` GALLERY_FULLRES / PHOTO_FULLRES / GALLERY_ZIP, `userId?`, `photoId?`, `orderId?`, `revokedAt?`), `PrintFulfillment`, `CashFund` (STRIPE / EXTERNAL), `Contribution` (`stripePaymentIntentId @unique`) | migrated |
| Studio Stripe account | `Studio.stripeAccountId String?` | column only |
| Env | `.env.example`: `STRIPE_SECRET_KEY=sk_test_placeholder`, `STRIPE_WEBHOOK_SECRET=whsec_placeholder` | not read by `env.ts`; nothing calls Stripe |
| Price sheets UI | `apps/admin/src/app/studios/[studioId]/pricing/page.tsx` + `saveProduct`/`deleteProduct` in `studios/[studioId]/actions.ts` (`studio.manage`) | works; seed creates "Default" sheet with GALLERY_UNLOCK $1500 and two PRINT placeholders |
| Comped unlock | `grantGalleryUnlock` / `revokeGalleryUnlock` in `.../events/[eventId]/gallery/actions.ts` (`entitlements.grant`, studio OWNER): creates `Entitlement { scope: GALLERY_FULLRES, userId: null, orderId: null }`; audit `entitlement.grant` / `entitlement.revoke` | works |
| Entitlement check | `apps/web/src/lib/gallery.ts` `isEntitledFullRes(eventId, userId)`: any unrevoked `GALLERY_FULLRES` with `userId null` or `= userId` | works |
| Where it is enforced | `toPhotoDTOs` picks `web` (clean) vs `webWm` (watermarked) and sets `canDownload`; `api/photos/[id]/download/route.ts` returns 403 `not_entitled` unless entitled or `viewer.isStudio` | works |
| Cash fund | admin `saveCashFund`/`deleteCashFund` (`registry.manage`); `kind: EXTERNAL` requires a Venmo/Zelle handle; `STRIPE` kind is stored but has no checkout | partial |
| Jobs | `PRINT_SUBMIT` worker handler is a logging stub | stub |

Rule of the product (README decisions): everyone sees watermarked images until the host's package is paid; then `GALLERY_FULLRES` for all; prints purchasable any time.

## Conventions in this repo
- **Entitlements are the only gate.** Never check `Order.status` in the gallery; create an `Entitlement` when an order is paid and let `isEntitledFullRes` (and future `PHOTO_FULLRES` / `GALLERY_ZIP` checks) decide. Comped and paid unlocks are indistinguishable to the viewer.
- **Money is integer cents** (`priceCents`, `totalCents`, `amountCents`, `goalCents`), currency lowercase ISO (`usd`). Admin forms convert with `Math.round(parseFloat(x) * 100)`; `fmtCents()` formats.
- **Placeholders are labelled as such** in UI copy (`pricing/page.tsx` description, `labSku` help). Keep that until real.
- **Stripe is the one direct-SDK exception** in the adapter rule (docs/01 §2), but still behind a thin `PaymentProvider` interface so test mode and a fake can be injected.
- **Never call Stripe with the placeholder key.** `sk_test_placeholder` is not a real key; any client construction must be guarded: `if (!env().STRIPE_SECRET_KEY?.startsWith("sk_test_") || env().STRIPE_SECRET_KEY === "sk_test_placeholder") throw/skip`. Live keys (`sk_live_`) must be refused in non-production `NODE_ENV`.

## Planned flow (docs/01 §8) and how to build it locally

1. **Connect onboarding (studio):** `stripe.accounts.create({ type: "express" })` -> store `Studio.stripeAccountId`; account link for onboarding; webhook `account.updated` to record charges-enabled. Admin page under `studios/[studioId]/settings`, `studio.manage`.
2. **Gallery unlock checkout (host):** server action on the guest site (`can("gallery.view")` + hostish) creates `Order { status: PENDING, totalCents }` and a Checkout Session on the connected account (`stripeAccount` header, `application_fee_amount`), stores `stripeCheckoutId`, redirects.
3. **Webhook** `apps/web/src/app/api/webhooks/stripe/route.ts` (`force-dynamic`, raw body, `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`): on `checkout.session.completed` -> in one transaction set `Order.status = PAID`, create `Entitlement { eventId, scope: GALLERY_FULLRES, userId: null, orderId }`, audit `order.paid`; on `charge.refunded` -> `REFUNDED` + `revokedAt`.
4. **Prints:** `OrderItem` per product/photo with `cropJson`; after PAID enqueue `PRINT_SUBMIT { orderId }`; lab adapter later.
5. **Cash fund:** Payment Link or Checkout recorded as `Contribution`.

### Local test-mode setup
```bash
# 1. real test keys in .env (never commit): STRIPE_SECRET_KEY=sk_test_..., STRIPE_WEBHOOK_SECRET from step 3
# 2. add to packages/shared/src/env.ts: STRIPE_SECRET_KEY: z.string().optional(), STRIPE_WEBHOOK_SECRET: z.string().optional()
# 3. forward webhooks to the web app (container, no local install):
docker run --rm -it --network host -e STRIPE_API_KEY=sk_test_... stripe/stripe-cli listen --forward-to http://localhost:3000/api/webhooks/stripe
#    prints "whsec_..." -> STRIPE_WEBHOOK_SECRET. (Or add a `stripe` service to infra/docker-compose.yml as docs/01 §2 suggests.)
# 4. trigger an event:
docker run --rm -it --network host -e STRIPE_API_KEY=sk_test_... stripe/stripe-cli trigger checkout.session.completed
```
Test cards: `4242 4242 4242 4242`, any future date, any CVC.

## Common tasks

### Implement the Stripe webhook (first real integration step)
1. Test first: `apps/web/src/lib/payments/apply-event.test.ts` -- a pure `applyStripeEvent(event, db)` with an in-memory fake db: `checkout.session.completed` with `metadata.orderId` yields `Order PAID` + one `GALLERY_FULLRES` entitlement; a second delivery of the same event is idempotent (check `Entitlement.orderId` exists); `charge.refunded` revokes. Run with node:test (add the app `test` script per `pnpm-monorepo`).
2. Implement `applyStripeEvent` with Prisma; the route only verifies the signature and calls it.
3. Add `stripe` dependency to `apps/web` (`pnpm --filter @hub/web add stripe`) and to `serverExternalPackages`.
4. Verify with `stripe trigger` above, then check `/platform/audit` for `order.paid`.

### Add an entitlement scope check (e.g. `GALLERY_ZIP`)
1. Test first: `apps/web/src/lib/gallery.test.ts` for a pure predicate over entitlement rows.
2. Add `isEntitledZip(eventId, userId)` next to `isEntitledFullRes`; use it in the (future) zip route; keep the "studio always entitled" rule from the download route.

### Change what the comped unlock does
Edit `grantGalleryUnlock`; it already refuses a second unrevoked grant. Any new scope needs a `revoke*` twin and audit rows.

## Gotchas
- `Entitlement` has no FK to `Order`/`Photo`; deleting an order leaves entitlements -- revoke explicitly.
- `isEntitledFullRes` is per event; a host paying for `priya-arjun` unlocks nothing elsewhere (correct).
- `Order.stripeCheckoutId` and `Contribution.stripePaymentIntentId` are `@unique` -- use them as idempotency keys for webhooks.
- Studio owners/staff see clean images via `viewer.isStudio` in the download route, but `toPhotoDTOs` only looks at entitlements, so a locked gallery shows the studio watermarked previews too (intentional preview of what guests see; pass `entitled: viewer.isStudio || await isEntitledFullRes(...)` if that should change).
- Guests buying prints "any time" is modelled but there is no guest-side store UI yet.
- `CashFund.kind = STRIPE` saves without any Stripe object; the guest Registry page does not exist yet (`RegistryContent` schema and admin editor do).
- Stripe Connect requires a verified business and platform profile (docs/04 long-lead) -- test mode works without it, live does not.

## Verification
```bash
pnpm typecheck && pnpm test
# comped unlock end-to-end: admin Gallery -> "Unlock gallery (comped)"; then as a guest:
curl -s -b 'hub_session=<guest cookie>' -H 'Host: priya-arjun.localhost' -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/photos/<photoId>/download   # 302 when entitled, 403 not_entitled otherwise
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT scope,"userId","orderId","revokedAt" FROM "Entitlement";'
```

## References
- `docs/01-architecture.md` §8 Payments and commerce (Connect, entitlement scopes, prints, cash fund)
- `docs/03-data-model.md` §2.11 (entitlements separate from orders)
- `docs/04-plan.md` Phase 2 Payments, §2 long-lead "Stripe account and Connect platform profile"
- Stripe Connect: https://docs.stripe.com/connect; Checkout: https://docs.stripe.com/payments/checkout; webhooks: https://docs.stripe.com/webhooks; CLI: https://docs.stripe.com/stripe-cli
- Related skills: `guest-site-patterns`, `admin-app-patterns`, `docker-local-infra`
