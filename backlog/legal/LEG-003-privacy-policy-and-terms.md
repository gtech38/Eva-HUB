---
id: LEG-003
title: Privacy policy and terms of service drafts
labels: [type:chore, area:legal, area:docs, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [LEG-007]
epic: EPIC-LEGAL
---

## Context
docs/04 long-lead: "Texas attorney review of the biometric consent text, host agreement, privacy policy and terms." Google OAuth verification (ADM-011) and 10DLC (INF-011) both require a public privacy policy URL. The event sites are private by design, so these documents are served from the root/admin domain.

**Decision (2026-10-08, docs/04 §3):** `/legal/privacy` and `/legal/terms` on the root domain are the only unauthenticated routes in the product. They exist because Stripe, Google OAuth verification (ADM-011) and 10DLC (INF-011) each need a public privacy-policy URL. Every other root and event-site path stays behind the sign-in gate; WEB-014 (OG metadata) relies on this.

## Scope
- `legal/privacy/v1/privacy.{en,te,hi}.md`: data categories (identity, contacts, RSVP and meal data, photos, face geometry/embeddings, payment metadata, usage logs), sources (host import, the person, device), purposes, legal bases/consent, biometric section mirroring LEG-001 and the retention matrix (LEG-007), sharing (studio as controller for its events, processors: hosting, Stripe, SMS/email providers, print lab), cookies (session + language only), rights and how to exercise them (DSAR flow), children (guardian search; no accounts for minors), Texas-specific disclosures, contact.
- `legal/terms/v1/terms.en.md`: platform terms for hosts, guests and (later) studios; acceptable use; photos licence; payments/refunds; disclaimers.
- Serve at `https://<ROOT_DOMAIN>/legal/privacy` and `/legal/terms` from `apps/web/src/app/root/legal/[doc]/page.tsx` (no session required — the only public pages; `robots` allowed for these two paths only; update `robots.txt` route and `X-Robots-Tag` header matcher accordingly), locale from cookie.
- Links: sign-in gate footer, invitation email footer, admin login, account settings.
- Test: files present with version; the two legal routes return 200 without a cookie and every other root/event path still gates; robots allows exactly those paths.

## Out of scope
- Cookie banner (no non-essential cookies; document why none is needed). Legal review (LEG-006).

## Acceptance criteria
- [ ] `GET /legal/privacy` and `/legal/terms` return 200 unauthenticated; `GET /` on an event site still shows the gate (vitest route tests + e2e).
- [ ] `robots.txt` on the root domain allows `/legal/*` and disallows the rest; event subdomains disallow everything (unit).
- [ ] Each document has `version`, `effective` and `[COUNSEL]` markers where needed.

## Files
- `legal/privacy/v1/*.md`, `legal/terms/v1/terms.en.md`, `apps/web/src/app/root/legal/[doc]/page.tsx` (new), `apps/web/src/app/robots.txt/route.ts`, `apps/web/next.config.ts` (headers matcher), `apps/web/src/components/SignIn.tsx`, `apps/admin/src/app/login/page.tsx`, `packages/shared/src/templates/*.ts`

## Verification
```bash
pnpm --filter @hub/web test
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/legal/privacy
```

## Notes for agents
First failing test: public legal route vs gated event route. Keep the markdown → HTML rendering server-side with a sanitiser; no client JS needed.
