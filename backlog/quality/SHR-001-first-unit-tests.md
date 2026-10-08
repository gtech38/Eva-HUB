---
id: SHR-001
title: First unit tests for shared auth helpers and web gallery rules
labels: [type:tech-debt, area:shared, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 0 — Foundations
depends_on: [INF-001]
epic: EPIC-QUALITY
---

## Context
`packages/shared/src/auth.ts` (token hashing, cookie signing, `normalizeContact`) and `apps/web/src/lib/gallery.ts` (`visibleVisibilities`, `visiblePhotoWhere`, `toPhotoDTOs` entitlement choice) decide security-relevant behaviour and have zero tests. These are pure or near-pure functions and are the cheapest high-value coverage.

## Scope
- `packages/shared/src/auth.test.ts`: `hashToken` is sha256 hex; `encodeCookie`/`decodeCookie` round-trip and reject a tampered signature and a wrong-length signature; `normalizeContact` lower-cases emails, converts `(512) 555-0101` to `+15125550101`, keeps `+44...`, returns null for junk; `newOtp` is 6 digits.
- `packages/shared/src/sms.test.ts`: `smsSegments` returns 1 for 160 GSM chars, 2 for 161, 1 for 70 Telugu chars, 2 for 71.
- `apps/web/src/lib/gallery.test.ts`: `visibleVisibilities` for guest / host / studio viewers; `visiblePhotoWhere` always includes `status: "READY"` and `hidden: false`; `toPhotoDTOs` picks `webWm` when not entitled and `web` when entitled (mock `@hub/db` prisma.favorite.findMany and `storage.derivativeUrl` with `vi.mock`).
- `env()` test: missing `DATABASE_URL` throws a message listing the key.

## Out of scope
- Integration tests hitting Postgres. Policy tests (already exist).

## Acceptance criteria
- [ ] All new tests pass under `pnpm test`.
- [ ] `packages/shared` line coverage is at or above 80 % (INF-004 threshold).
- [ ] A deliberate bug (`decodeCookie` returning `id` without `timingSafeEqual`) is caught by the tamper test.

## Files
- `packages/shared/src/auth.ts`, `packages/shared/src/sms.ts`, `packages/shared/src/env.ts`
- `apps/web/src/lib/gallery.ts`

## Verification
```bash
pnpm --filter @hub/shared test
pnpm --filter @hub/web test
```

## Notes for agents
First failing test: `auth.test.ts` tamper case. `env()` caches; use `vi.resetModules()` between env tests. Set `AUTH_SECRET` in the test setup file.
