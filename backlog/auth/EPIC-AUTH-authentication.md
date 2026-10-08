---
id: EPIC-AUTH
title: Authentication, accounts and re-authentication
labels: [type:epic, area:shared, priority:p1, size:L]
milestone: Phase 1 — MVP
---

## Context
Auth is a self-contained implementation in `packages/shared/src/auth.ts` (signed cookie → `Session` row, hashed tokens). It supports magic links and invitation links only. docs/02-users-and-roles.md and docs/04-plan.md Phase 0/1 require OTP codes (email and SMS), a re-authentication gate with UI, "Not you?" flows, the duplicate-user merge, account settings (revoke face profile, contact points), and passkeys in Phase 3. There is no rate limiting on any sign-in or selfie endpoint beyond the worker's process-wide token bucket.

## Children
- SHR-002 OTP code sign-in by email and SMS
- WEB-005 Re-authentication and "Not you?" flows on guest site and admin
- SHR-003 Rate limiting and lockout for sign-in, OTP, invite and selfie endpoints
- ADM-005 Invite-token expiry aligned to event end + 90 days
- WEB-006 Account settings: contact points, verification, face profile, delete my data
- WEB-007 "My events" cross-event dashboard
- SHR-004 Duplicate-user merge flow
- WEB-008 Passkeys (WebAuthn)

## Definition of Done
- [ ] A guest can sign in with a 6-digit code on either channel and the response never reveals guest-list membership.
- [ ] An INVITE_LINK session that attempts an elevated action is routed through a step-up flow and returns to where it was.
- [ ] Sign-in and selfie endpoints are rate limited per address and per IP with tests.
- [ ] A user can see and manage their contacts, revoke their face profile and request deletion from one page.
