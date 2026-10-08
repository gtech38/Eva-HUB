---
id: EPIC-SAAS
title: SaaS readiness: self-serve studios, billing, platform console
labels: [type:epic, area:admin, priority:p3, size:L]
milestone: Phase 3 — SaaS readiness
---

## Context
The data model is tenant-ready (Studio → Event, `PLATFORM_ADMIN` separate from `STUDIO_OWNER`), but everything else assumes one studio created by the platform admin. docs/04 Phase 3: self-serve signup, Stripe Billing with plan limits and usage metering, platform console with support impersonation, per-studio branding defaults, isolation pen test, optional multi-region storage. Depends on EPIC-TENANCY (RLS) and EPIC-COMMERCE (Stripe) landing first.

## Children
- ADM-024 Self-serve studio signup and onboarding
- ADM-025 Stripe Billing subscriptions, plan limits and usage metering
- ADM-026 Platform admin console with audited support impersonation
- ADM-027 Studio-defined defaults: email branding, theme and watermark
- DOC-009 Tenant isolation penetration-test checklist
- INF-020 Spike: multi-region storage option

## Definition of Done
- [ ] A photographer can sign up, create a studio, connect Stripe, subscribe to a plan and publish an event without platform-admin involvement.
- [ ] Plan limits (storage, photos, SMS) are enforced with clear messaging and usage is metered daily.
- [ ] Support staff can impersonate a studio user with an audit trail visible to that studio.
- [ ] The isolation pen-test checklist has been executed against staging with findings closed.
