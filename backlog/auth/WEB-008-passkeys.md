---
id: WEB-008
title: Passkeys (WebAuthn) registration and sign-in
labels: [type:feature, area:web, area:shared, priority:p3, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [WEB-006]
epic: EPIC-AUTH
---

## Context
docs/01 §9 lists optional passkeys; `AuthMethod.PASSKEY` exists. Useful for hosts and studio staff who sign in often; guests keep links and codes.

## Scope
- `@simplewebauthn/server` in shared: `Passkey(id, userId, credentialId, publicKey, counter, transports, createdAt, lastUsedAt, name)` table + migration.
- Registration from `/account` (WEB-006): challenge stored in `LoginToken` (purpose `PASSKEY_CHALLENGE`, add to enum) for 5 minutes; verify and store.
- Sign-in: "Use a passkey" button on the event-site `SignIn` and admin login; discoverable-credential flow (no username); on success create a `PASSKEY` session; counter check; audit `auth.passkey`.
- RP ID = `ROOT_DOMAIN`; origins = event origins + admin origin; document that passkeys registered on `localhost` do not carry to production.
- Remove passkey from `/account`.

## Out of scope
- Passwords (off by design). Cross-device sync concerns.

## Acceptance criteria
- [ ] Unit tests with `@simplewebauthn/server` test vectors: registration verifies and stores the credential; sign-in with a replayed counter fails.
- [ ] e2e with Playwright's virtual authenticator (`CDP WebAuthn.addVirtualAuthenticator`): register from `/account`, sign out, sign in with the passkey on the admin app.
- [ ] Policy: a `PASSKEY` session counts as fresh for the 12 h gate (`authedAt` set).

## Files
- `packages/shared/src/passkeys.ts`, `packages/shared/src/passkeys.test.ts` (new), `packages/db/prisma/schema.prisma` + migration
- `apps/web/src/app/sites/[slug]/account/passkeys/*`, `apps/web/src/components/SignIn.tsx`, `apps/admin/src/app/login/*`

## Verification
```bash
pnpm --filter @hub/shared test
pnpm e2e --grep passkey
```

## Notes for agents
Start with the replayed-counter unit test. Keep WebAuthn logic in shared; apps only hold routes.
