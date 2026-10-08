---
id: SHR-026
title: Face search must not run from an invitation-link session
labels: [type:bug, area:shared, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-LEGAL
---

## Context
Found in review of the LEG-005 compliance checklist (docs/compliance/biometrics.md, COPPA row P7, gap G14). `face.search` is not in the `ELEVATED` set in `packages/shared/src/policy.ts`, so a session created from an invitation link (`createSession(userId, "INVITE_LINK", ...)`, minted in `apps/web/src/app/sites/[slug]/i/[token]/route.ts`) passes `can("face.search")` for any guest. Invitation links are designed to be forwardable by accident ("please don't forward it"), and every other consequential action already refuses them. The consent row records `consentedByUserId` = the user the link was minted for, so whoever holds a forwarded link can tick the biometric consent as the invitee, search as them, and (guardian search) search for a child in the invitee's household.

## Scope
- Add `face.search` to `ELEVATED` (invitation-link sessions are refused, and sessions older than the 12 h re-auth window must sign in again).
- The search route returns `403 forbidden` (existing reason) for these sessions; the gallery "Find me" link and the `/gallery/me` page are hidden for them, with a one-line "sign in to use face search" message instead of an error.
- Cover `INVITE_LINK` and stale-session cells in `policy.test.ts`.

## Out of scope
- Whether a verified-contact session is enough proof of who is holding the phone (WEB-041 and counsel).
- Changing how invitation sessions work for RSVP.

## Acceptance criteria
- [ ] `can(principal with authMethod INVITE_LINK, "face.search", ...)` is false for hosts and guests; a magic-link or passkey session still passes.
- [ ] A session older than 12 h fails `face.search` until re-authentication.
- [ ] `POST /api/face/search` with an invitation-link session returns 403 and never calls the worker or writes a `BiometricConsent` row.
- [ ] The gallery page shows the sign-in prompt, not the search form, for an invitation-link session.

## Files
`packages/shared/src/policy.ts`, `packages/shared/src/policy.test.ts`, `apps/web/src/app/api/face/search/route.ts` (+ `route.test.ts`), `apps/web/src/app/sites/[slug]/gallery/me/page.tsx`, `apps/web/src/app/sites/[slug]/gallery/page.tsx`

## Verification
```bash
pnpm --filter @hub/shared test
pnpm --filter @hub/web test
```

## Notes for agents
Red first: one `policy.test.ts` case per new matrix cell (auth-sessions-policy skill). Check the existing `route.test.ts` principal factory; it probably builds a magic-link session. Update P7/G14 in `docs/compliance/biometrics.md` when this lands.
