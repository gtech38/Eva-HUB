---
id: EPIC-COMMERCE
title: Commerce: Stripe Connect, gallery unlock, prints, cash fund
labels: [type:epic, area:web, priority:p1, size:L]
milestone: Phase 2 — Commerce, messaging, polish
---

## Context
The data model for commerce exists (`PriceSheet`, `Product`, `Order`, `OrderItem`, `Entitlement`, `PrintFulfillment`, `Contribution`, `Studio.stripeAccountId`) and the admin can grant/revoke a comped `GALLERY_FULLRES` entitlement and manage products. Stripe is a placeholder (`STRIPE_SECRET_KEY=sk_test_placeholder`, no SDK installed), `PRINT_SUBMIT` is a stub, and no checkout exists. docs/01 §8 fixes the model: Connect from day one, host package unlocks the gallery, prints always purchasable, cash fund via Checkout or an external handle.

## Children
- INF-008 Stripe test-mode local setup with `stripe listen`
- INF-009 Stripe account, Connect platform profile and print lab account (external)
- SHR-009 PaymentProvider interface, Stripe adapter and webhook event store
- ADM-019 Stripe Connect onboarding for the studio
- WEB-022 GALLERY_UNLOCK checkout → webhook → entitlement
- WEB-024 Print store: price sheet, crop UI, cart, checkout
- WRK-014 PRINT_SUBMIT with a PrintLab adapter interface and a fake lab
- WEB-025 Cash fund contributions via Checkout
- ADM-021 Refunds, receipts and ledger page

## Definition of Done
- [ ] A host pays for the package in Stripe test mode and every guest immediately sees clean images and downloads.
- [ ] A guest orders a print; the order reaches the (fake) lab and the fulfilment status flows back.
- [ ] Refunding an unlock revokes the entitlement; every order has a receipt email and appears in the ledger.
- [ ] No Stripe call happens unless `STRIPE_SECRET_KEY` starts with `sk_`; local default remains placeholder-safe.
