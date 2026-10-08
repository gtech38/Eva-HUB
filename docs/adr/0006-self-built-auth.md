# ADR-0006: Self-built session and magic-link auth instead of Better Auth for the POC

- Status: Accepted
- Date: 2026-10-08
- Tickets: SHR-002, SHR-003, SHR-004, WEB-008

## Context

docs/01 section 9 and docs/04 Phase 0 recommend Better Auth (magic link, email OTP, phone OTP, Prisma adapter, self-hosted). The auth model here is unusual: every guest gets a personal invitation link that must create a session scoped to one event, such a session must never perform host actions, elevated actions need a recent authentication, and a `Guest` may be linked to a `User` only through a verified contact (docs/02).

## Decision

For the POC, auth is a small module we own, not Better Auth. The `hub_session` cookie is `<sessionId>.<HMAC-SHA256 with AUTH_SECRET>` and carries no claims; everything is loaded from the `Session` and `User` rows per request. Magic-link and invitation tokens are random, stored only as SHA-256 hashes (`LoginToken`, `InviteToken`). `authMethod` decides scope: `INVITE_LINK` sessions are bound to one event (`guestScopeEventId`), expire no later than their invitation, and fail every elevated action in `can()`; other sessions get the normal TTL and a 12 hour re-authentication gate for elevated actions. Linking a `Guest` to a `User` happens only in `resolveUserForVerifiedContact` and `linkGuestsForContact`. Sign-in responses are identical whether or not an address is on the guest list.

## Consequences

- The invite-link scope and linking rules sit in our code and tests (`policy.test.ts`) rather than being bent around a library's session model.
- We own the security surface: rate limiting and lockout (SHR-003), OTP sign-in (SHR-002), duplicate-user merge (SHR-004) and expiry of stale `Session` rows are our work.
- Revisit and consider Better Auth (or Auth.js) when any of these holds: passkeys or other providers are wanted beyond what WEB-008 builds on `@simplewebauthn/server`, the code header's own trigger; the maintenance cost of SHR-002 to SHR-004 exceeds the cost of adapting the invite-link model to a library; or a security review prefers a maintained implementation. A switch must preserve the `INVITE_LINK` rules and cookie behaviour in `docs/02`.
- docs/01 section 9 and docs/04 still recommend Better Auth; DOC-012 updates them.

## Alternatives

- Better Auth: the documented recommendation. Deferred, not rejected; see the criteria above.
- Auth.js: the documented fallback, with the same session-model fit question.

## References

- `packages/shared/src/auth.ts`
- `packages/shared/src/policy.ts`
- `packages/shared/src/policy.test.ts`
- `apps/web/src/lib/session.ts`
- `apps/admin/src/lib/auth.ts`
- `docs/01-architecture.md` section 9
- `docs/02-users-and-roles.md`
