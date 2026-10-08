---
id: WEB-005
title: Re-authentication and "Not you?" flows on guest site and admin
labels: [type:feature, area:web, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [SHR-002]
epic: EPIC-AUTH
---

## Context
`authorize()` in `apps/admin/src/lib/auth.ts` redirects to `/login?reauth=1` but the login page does not explain why or return the user to where they were. On the guest site, an INVITE_LINK session can never do elevated actions (policy) yet a host who arrives via a forwarded invite gets no path to step up. "Not you? Get your own link" exists as a chrome link (`NotYou` in `apps/web/src/components/chrome.tsx`) but only signs out. docs/02 §2 rule 1 and docs/04 risk "Forwarded invitation links".

## Scope
- Admin `/login`: when `reauth=1`, show "Confirm it's you — sessions older than 12 hours must re-authenticate before changes", preserve `next=<path>` through the magic link/OTP (`LoginToken.redirectTo`), and after success replace the old session (same `Session.id` semantics: destroy old, create new, keep `guestScopeEventId` null).
- Guest site: `/auth/step-up` page offered when a viewer with host/planner roles browses under an INVITE_LINK session ("You opened an invitation link. To manage this event, sign in with a code."); OTP via SHR-002; on success the session becomes `EMAIL_OTP`/`SMS_OTP` and `redirectTo` is honoured.
- "Not you?" → `/auth/not-you`: signs out, explains that the link was personal, and shows the sign-in form prefilled empty; the audit row `auth.not_you` records the previous guest id (no PII).
- Shared helper `apps/web/src/lib/session.ts` `replaceSession(oldId, ...)`.
- Admin: pages that call `requireAdmin` show a banner when `isStale` for `studio.view` rather than a hard redirect on read.

## Out of scope
- Passkeys. Changing the 12 h constant (`REAUTH_HOURS` in policy).

## Acceptance criteria
- [ ] e2e: aged admin session saving settings lands on `/login?reauth=1&next=/studios/.../settings`, completes OTP, and is returned to the settings page with the form still functional.
- [ ] e2e: host opens `/i/<token>`, visits `/auth/step-up`, enters the code from Mailpit, and `Session.authMethod` becomes `EMAIL_OTP`.
- [ ] "Not you?" destroys the session (cookie cleared, `Session` row deleted) and writes `auth.not_you`.
- [ ] `redirectTo` only accepts same-origin relative paths (unit test).

## Files
- `apps/admin/src/app/login/{page.tsx,LoginForm.tsx,actions.ts}`, `apps/admin/src/app/auth/callback/route.ts`, `apps/admin/src/lib/auth.ts`
- `apps/web/src/app/sites/[slug]/auth/{actions.ts,step-up/page.tsx,not-you/page.tsx}` (new pages), `apps/web/src/components/chrome.tsx`, `apps/web/src/lib/session.ts`
- `e2e/specs/admin/reauth.spec.ts`, `e2e/specs/web/invite-link.spec.ts`

## Verification
```bash
pnpm e2e --grep "reauth|step-up|not you"
pnpm --filter @hub/web test
```

## Notes for agents
Start with the `redirectTo` validation unit test. The policy already blocks INVITE_LINK; this ticket only adds the user path, never a bypass.
