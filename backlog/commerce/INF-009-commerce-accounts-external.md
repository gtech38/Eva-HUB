---
id: INF-009
title: Stripe account, Connect platform profile and print lab account (external)
labels: [type:chore, area:infra, priority:p1, size:S]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [INF-019, LEG-003]
epic: EPIC-COMMERCE
---

## Context
docs/04 long-lead items: "Stripe account and Connect platform profile — business verification" and "Print lab account (WHCC requires a pro account and API access approval)". Human steps; tracked so the code tickets have a real external blocker.

## Scope
Human checklist:
- [ ] Create the Stripe account for the platform entity; complete business verification; enable Connect (Express) and fill the platform profile (loss liability, onboarding responsibilities).
- [ ] Set branding (name, icon, colours) used on Checkout and Express onboarding; set statement descriptor.
- [ ] Create restricted API keys for production (`rk_live_`) scoped to Checkout, Connect, Refunds, Webhooks; store in the secret manager (DOC-005).
- [ ] Register production webhook endpoint URL (after INF-018) and record the signing secret.
- [ ] Open the print lab pro account (WHCC or chosen alternative); request API access; record sandbox credentials and the product catalogue export for WEB-024 SKU mapping.
- [ ] Decide print pricing defaults with the studio owner; seed a default `PriceSheet` (ADM-020 scope lives in WEB-024).

## Out of scope
- Code.

## Acceptance criteria
- [ ] Live Stripe keys and lab sandbox credentials exist in the secret store; this ticket records dates and account ids (not secrets).

## Files
- none

## Verification
Stripe dashboard shows Connect enabled; lab sandbox login works.

## Notes for agents
Not agent work.
