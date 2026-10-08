---
id: SHR-017
title: Apply the per-address rate limit to OTP code verification
labels: [type:feature, area:shared, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [SHR-002, SHR-003]
epic: EPIC-AUTH
---

## Context
SHR-003 added Postgres-backed rate limits and defined the `otpVerifyAddress` policy (10 checks per address per 15 minutes) in `packages/shared/src/ratePolicies.ts`, but there was no OTP verify step to apply it to: SHR-002 (OTP sign-in) had not landed and explicitly leaves rate limiting to SHR-003. SHR-002's per-token attempt cap (5) stops guessing one code; it does not stop requesting a fresh code and guessing again, which is what the per-address limit is for. Found while working SHR-003.

## Scope
- Where SHR-002's code-entry action calls `verifyLoginCode(sentTo, code)`, first call `rateLimits.check("otpVerifyAddress", normalizedAddress, { studioId, eventId })` (web) and the admin equivalent if SHR-002 adds one.
- Over the limit: the same response as a wrong code (no "too many attempts" copy), `verifyLoginCode` not called, nothing burned.
- Check before any account or guest-list lookup so on-list and off-list addresses are counted the same way.

## Out of scope
- Changing the policy numbers or the limiter itself (SHR-003). CAPTCHA.

## Acceptance criteria
- [ ] Vitest: 11 code checks for one address within 15 minutes; the 11th returns the wrong-code response and `verifyLoginCode` is called 10 times (limiter on `memoryRateLimitStore()`, as in `apps/web/src/app/sites/[slug]/auth/actions.test.ts`).
- [ ] Vitest: an off-list address and an on-list address get identical responses at and over the limit.
- [ ] One `auth.rate_limited` audit row with `policy: "otpVerifyAddress"` and the hashed key only.

## Files
- the OTP verify action added by SHR-002 (web, and admin if present), its test
- `packages/shared/src/ratePolicies.ts` (read only)

## Verification
```bash
pnpm --filter @hub/web test
pnpm --filter @hub/shared test
```

## Notes for agents
Mock `@hub/shared/ratePolicies` and delegate `rateLimits` to `rateLimiter({ store: memoryRateLimitStore(), audit, env: {}, random: () => 1 })`; see the SHR-003 tests for the pattern.
