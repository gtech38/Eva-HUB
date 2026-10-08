---
id: SHR-017
title: Production env check for SMS_PROVIDER once real SMS providers exist
labels: [type:chore, area:shared, priority:p2, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-011]
epic: EPIC-MESSAGING
---

## Context
DOC-005 added production validation to `env()` (`productionIssues()` in `packages/shared/src/env.ts`) for `AUTH_SECRET`, `S3_PUBLIC_ENDPOINT` and `EMAIL_PROVIDER`. Its scope also named "`SMS_PROVIDER` only when SMS features are on", but today `SMS_PROVIDER` only accepts `console` and there is no switch saying SMS is on, so any rule would either do nothing or make production impossible to configure. SHR-011 adds Twilio/Telnyx; this ticket adds the check after it lands.

## Scope
- An explicit switch for outbound SMS in production (e.g. `SMS_ENABLED`, default `false`), read by `env.ts` and listed in `scripts/env-meta.mjs`.
- `productionIssues()`: when production and SMS is enabled, `SMS_PROVIDER` must not be `console`, and the selected provider's credentials (from SHR-011) must be present. Messages name the variable, never the value.
- Credentials for the provider marked `secret: true` in `scripts/env-meta.mjs`; `pnpm env:docs` regenerates `.env.example` and `docs/deploy/env.md`.

## Out of scope
- The provider adapters themselves (SHR-011) and 10DLC registration (INF-011).

## Acceptance criteria
- [ ] `env()` throws in production when SMS is enabled and `SMS_PROVIDER=console` (unit test with `NODE_ENV=production`).
- [ ] `env()` accepts production with SMS disabled and `SMS_PROVIDER=console`.
- [ ] `node scripts/env-docs.mjs --check` passes with the new variables documented.

## Files
- `packages/shared/src/env.ts`, `packages/shared/src/env.test.ts`, `scripts/env-meta.mjs`, `.env.example`, `docs/deploy/env.md`

## Verification
```bash
pnpm --filter @hub/shared test
node scripts/env-docs.mjs --check
```

## Notes for agents
First failing test: production + SMS enabled + console provider throws. Follow the existing `productionIssues()` pattern in `env.ts`.
