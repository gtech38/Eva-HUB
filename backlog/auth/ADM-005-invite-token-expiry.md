---
id: ADM-005
title: Invite-token expiry aligned to event end + 90 days, defined once in shared
labels: [type:tech-debt, area:admin, area:shared, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-AUTH
---

## Context
docs/02 §2 rule 3: "A link stays valid until the event ends plus 90 days." `apps/admin/src/lib/invites.ts` `inviteExpiry()` uses `Event.startsOn + 90d` (or now + 180d when no date), ignoring sub-events that end later, and the constant lives in the admin app while the web app validates tokens. `INVITE_SESSION_TTL_DAYS=90` in `.env.example` is unrelated to the token lifetime and is not derived from the event. Resend already revokes previous tokens (`resendInvite`), which is correct and must stay.

## Scope
- Move to `packages/shared/src/invites.ts`: `inviteExpiry(event: { startsOn, subEvents: { endsAt, startsAt }[] })` = `max(startsOn, max(subEvent.endsAt ?? startsAt)) + 90 days`, fallback `now + 180 days`; export `INVITE_GRACE_DAYS = 90`.
- Admin `sendInvitations`/`resendInvite` use it (load sub-events). Settings/schedule changes that move the end date later re-extend active tokens (`updateMany expiresAt` for non-revoked tokens) and audit `invite.extend`.
- Web `/i/[token]`: on an expired or revoked token show a page "This link has expired — enter your email or phone for a new one" that reuses `SignIn` instead of redirecting to `/?error=invite` with no explanation.
- Invite session TTL: `createSession` for INVITE_LINK uses `min(env.INVITE_SESSION_TTL_DAYS, days until token expiry)`.

## Out of scope
- Changing what the invite email says (SHR-013 templates).

## Acceptance criteria
- [ ] Unit tests for `inviteExpiry`: event with reception ending after `startsOn` → reception end + 90 d; no dates → now + 180 d; `startsOn` only → startsOn + 90 d.
- [ ] Editing a sub-event to end later extends active tokens (vitest with Postgres).
- [ ] e2e: expired token page renders the sign-in form and the heading mentions expiry.

## Files
- `packages/shared/src/invites.ts` (new, moved from `apps/admin/src/lib/invites.ts`), `packages/shared/src/invites.test.ts`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/actions.ts`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts` (`saveSubEvent`)
- `apps/web/src/app/sites/[slug]/i/[token]/route.ts`, `packages/shared/src/auth.ts`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
pnpm e2e --grep "expired"
```

## Notes for agents
The expiry unit tests are the first failing tests. Keep `buildMessages` in admin (it is presentation); only the date rule moves to shared.
