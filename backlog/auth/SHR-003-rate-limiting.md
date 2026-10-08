---
id: SHR-003
title: Rate limiting and lockout for sign-in, OTP, invite and selfie endpoints
labels: [type:feature, area:shared, area:web, area:admin, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-AUTH
---

## Context
`requestSignIn` (web), `requestMagicLink` (admin), `/i/[token]`, `/auth/callback` and `POST /api/face/search` have no per-client limits. The worker's `/embed-selfie` has only a process-wide 10 req/s bucket. An attacker can spray codes (once SHR-002 lands), enumerate invite tokens, or run the face pipeline as a DoS. No Redis is available by design, so limits live in Postgres.

## Scope
- `packages/shared/src/ratelimit.ts`: `limit(key: string, { max, windowSec })` implemented on a new `RateLimit(key text PK, count int, resetAt timestamptz)` table with a single `INSERT ... ON CONFLICT DO UPDATE` statement; returns `{ ok, remaining, retryAfterSec }`. Keys are `sha256(scope:value)`; a janitor deletes expired rows opportunistically (1 % of calls).
- Policies (constants in one file, env-overridable): sign-in request 5/15 min per address and 30/15 min per IP; OTP verify 10/15 min per address; invite-token hits 60/h per IP; face search 10/h per user and 3 concurrent; admin magic link 5/15 min per address.
- Apply in: `apps/web/src/app/sites/[slug]/auth/actions.ts`, `apps/web/src/app/sites/[slug]/i/[token]/route.ts`, `apps/web/src/app/api/face/search/route.ts`, `apps/admin/src/app/login/actions.ts`. Over-limit responses keep the neutral message for sign-in (no "too many attempts" leak to enumerators) but skip sending; face search returns 429 with `reason: "rate_limited"` (add to `FaceSearchReason`).
- IP from `x-forwarded-for` first hop, documented trust assumption for the reverse proxy.
- Audit `auth.rate_limited` with hashed key when a limit trips.

## Out of scope
- Worker-side per-client limits (web is the only caller). CAPTCHA.

## Acceptance criteria
- [ ] Unit test: 5 calls pass, the 6th within the window returns `ok: false` with `retryAfterSec > 0`; after `resetAt` it passes again (use a fake clock by passing `now`).
- [ ] Concurrency test: 50 parallel `limit()` calls on one key never exceed `max` successes (Postgres atomicity).
- [ ] e2e: 6 sign-in requests for one address yield 5 Mailpit messages and identical responses.
- [ ] Face search returns 429 after 10 searches per user per hour (vitest with mocked worker).

## Files
- `packages/shared/src/ratelimit.ts`, `packages/shared/src/ratelimit.test.ts` (new), `packages/db/prisma/schema.prisma` + migration `rate_limit`
- `apps/web/src/app/sites/[slug]/auth/actions.ts`, `apps/web/src/app/sites/[slug]/i/[token]/route.ts`, `apps/web/src/app/api/face/search/route.ts`, `apps/web/src/lib/face.ts`
- `apps/admin/src/app/login/actions.ts`

## Verification
```bash
pnpm --filter @hub/shared test
pnpm e2e --grep "rate"
```

## Notes for agents
Write the "6th call fails" unit test first. Keep the SQL to one statement so it is safe under concurrency without advisory locks. Never return different sign-in copy when limited.
