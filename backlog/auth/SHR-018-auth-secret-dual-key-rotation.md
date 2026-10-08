---
id: SHR-018
title: Dual-key AUTH_SECRET so rotation does not sign everyone out
labels: [type:feature, area:shared, priority:p2, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-AUTH
---

## Context
`AUTH_SECRET` signs the `hub_session` cookie (`sign()`/`decodeCookie()` in `packages/shared/src/auth.ts`) and salts IP hashes in the face-search route. Only one key is accepted, so the rotation procedure in `docs/deploy/env.md#rotation` (DOC-005) signs every user out. A grace-period second key makes rotation routine.

## Scope
- New optional env `AUTH_SECRET_PREVIOUS` in `env.ts` (same production strength rule as `AUTH_SECRET` when set), metadata in `scripts/env-meta.mjs` (`secret: true`).
- `decodeCookie()` accepts a signature made with either key (constant-time compare for each); `encodeCookie()` always signs with `AUTH_SECRET`.
- Rotation section of `docs/deploy/env.md` rewritten: set `AUTH_SECRET_PREVIOUS` = old, `AUTH_SECRET` = new, restart; remove `AUTH_SECRET_PREVIOUS` after the longest session TTL.

## Out of scope
- Re-signing existing cookies server-side; IP-hash continuity across rotation.

## Acceptance criteria
- [ ] A cookie signed with the previous key decodes while `AUTH_SECRET_PREVIOUS` holds that key, and does not decode once it is removed.
- [ ] New cookies are always signed with `AUTH_SECRET`.
- [ ] `env()` in production rejects a weak `AUTH_SECRET_PREVIOUS` without echoing it.
- [ ] `node scripts/env-docs.mjs --check` passes.

## Files
- `packages/shared/src/auth.ts` + `auth.test.ts`, `packages/shared/src/env.ts` + `env.test.ts`, `scripts/env-meta.mjs`, `docs/deploy/env.md`, `.env.example`

## Verification
```bash
pnpm --filter @hub/shared test
node scripts/env-docs.mjs --check
```

## Notes for agents
First failing test: a cookie signed with the old key is accepted when `AUTH_SECRET_PREVIOUS` is set. `env()` caches, so use `vi.stubEnv` + `vi.resetModules()` as `env.test.ts` does.
