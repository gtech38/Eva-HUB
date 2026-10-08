---
id: ADM-024
title: Self-serve studio signup and onboarding
labels: [type:feature, area:admin, priority:p3, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [SHR-002, DB-004]
epic: EPIC-SAAS
---

## Context
Studios are created only via `/platform` by a platform admin (`createStudio`). docs/04 Phase 3: "Self-serve studio signup." Needs the tenancy hardening to be in place first (RLS), because the first external studio is the first real isolation test.

## Scope
- `/signup` on the admin app (feature flag `SELF_SERVE_SIGNUP=true`): email → OTP (SHR-002) → create `User(CLAIMED)` + `Studio` (name, slug with availability check, timezone) + `StudioMember(OWNER)` + `Domain(app-level)`; accept terms (LEG-003) with version recorded in `AuditLog studio.signup`; anti-abuse: SHR-003 limits + disposable-email denylist.
- Onboarding checklist on the studio home: set branding (`brandJson.credit/url/logoText`), connect Stripe (ADM-019), choose plan (ADM-025), create first event; progress persisted in `Studio.onboardingJson`.
- Slug reservation list (`app`, `www`, `api`, `admin`, `mail`, existing event slugs at root).
- Platform admin sees new studios on `/platform` with a "suspend" action (`Studio.suspendedAt` + migration; suspended studios' sites show a neutral unavailable page).

## Out of scope
- Billing (ADM-025). Custom domains (WEB-027/028).

## Acceptance criteria
- [ ] Signup creates exactly the rows above in one transaction and signs the user in (vitest with Postgres).
- [ ] Reserved slug and taken slug are rejected (unit).
- [ ] Suspended studio: admin pages 403, event sites show the unavailable page (vitest route tests).
- [ ] e2e: full signup via Mailpit OTP to first event creation.

## Files
- `apps/admin/src/app/signup/{page.tsx,actions.ts}` (new), `apps/admin/src/app/studios/[studioId]/page.tsx` (checklist), `apps/admin/src/app/platform/{page.tsx,actions.ts}`, `apps/web/src/lib/site.ts` (suspended check), `packages/db/prisma/schema.prisma` + migration

## Verification
```bash
pnpm --filter @hub/admin test && pnpm e2e --grep signup
```

## Notes for agents
First failing test: reserved slug rejection. Terms acceptance must store the document version string from LEG-003.
