---
id: SHR-016
title: Revoking an invitation token ends the INVITE_LINK sessions opened with it
labels: [type:bug, area:shared, area:web, area:admin, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [ADM-005]
epic: EPIC-AUTH
---

## Context
docs/02 §2 rule 3: "Rotating it (the host's 'resend invite') revokes the old one." Since ADM-005 an INVITE_LINK session ends no later than its token's `expiresAt`, but `Session` has no link to the `InviteToken` it came from. When a host resends (`resendInvite` sets `revokedAt` on every live token of the guest), typically because a link was forwarded to the wrong person, anyone who already opened the old link stays signed in for up to 90 days. Found in review of ADM-005 (PR #128).

## Scope
- Add `Session.inviteTokenId String?` (FK to `InviteToken`, `onDelete: SetNull`) in a migration; `/i/[token]` sets it via `createSession("INVITE_LINK", { …, inviteTokenId })`.
- `principalFromCookie` rejects an INVITE_LINK session whose invite token is revoked (one join, no extra query), so revocation takes effect on the next request.
- `resendInvite` additionally deletes sessions whose `inviteTokenId` it just revoked (belt and braces; keeps the Session table small), and audits the count in `invite.resend` data as `sessionsEnded`.

## Out of scope
- Ending EMAIL_LINK/SMS_OTP sessions of the same user (they proved control of a contact point).
- A host-facing "sign this guest out everywhere" button.

## Acceptance criteria
- [ ] A session opened from token T stops resolving (`principalFromCookie` returns null) as soon as T is revoked (vitest with Postgres).
- [ ] `resendInvite` deletes the sessions opened with the revoked tokens and records `sessionsEnded` in the audit row (vitest with Postgres).
- [ ] A session opened from a different, still-live token of the same guest is unaffected.

## Files
- `packages/db/prisma/schema.prisma` + migration
- `packages/shared/src/auth.ts` (`createSession`, `principalFromCookie`), `packages/shared/src/auth.test.ts`
- `apps/web/src/app/sites/[slug]/i/[token]/route.ts` and `route.test.ts`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/actions.ts` and `actions.test.ts`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test && pnpm --filter @hub/admin test
pnpm verify
```

## Notes for agents
Start with the failing `principalFromCookie` test. Make `inviteTokenId` part of the `InviteSessionOptions` type so INVITE_LINK sessions cannot be created without it. Keep the dead-link answer of `/i/[token]` unchanged (same redirect for every failure).
