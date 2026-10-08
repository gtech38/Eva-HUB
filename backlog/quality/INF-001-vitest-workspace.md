---
id: INF-001
title: Vitest workspace for shared, db, web and admin
labels: [type:chore, area:infra, area:shared, priority:p0, size:S, agent-ready]
milestone: Phase 0 — Foundations
epic: EPIC-QUALITY
---

## Context
`packages/shared` tests run with `node --import tsx --test`; `apps/web`, `apps/admin` and `packages/db` have no `test` script at all, so `pnpm test` silently passes for them. One runner across the monorepo lets every backlog ticket say "write the failing test in `*.test.ts`" without per-package setup.

## Scope
- Add `vitest` (+ `@vitest/coverage-v8`) at the workspace root; add a root `vitest.config.mts` whose `test.projects` lists `packages/shared`, `packages/db`, `apps/web`, `apps/admin` (Vitest 4 removed `vitest.workspace.ts`; 4.x is the newest line that supports Node 20).
- Per-package `vitest.config.ts`: `environment: "node"`; for the Next apps add the `@/` alias from `tsconfig.json` and `server-only` stub.
- Convert `packages/shared/src/policy.test.ts` from `node:test`/`node:assert` to vitest (`describe/it/expect`) without changing assertions.
- `test` script in each package = `vitest run`; root `pnpm test` keeps working via `pnpm -r test`.
- A `test/setup.ts` in each Next app that loads `../../.env` the same way `next.config.ts` does, so `env()` parses in tests.

## Out of scope
- Browser/e2e tests (INF-003), coverage thresholds (INF-004), ESLint (INF-002).

## Acceptance criteria
- [ ] `pnpm test` from the root runs vitest in all four packages and reports the six existing policy tests as passing.
- [ ] A new file `apps/web/src/lib/__smoke__.test.ts` containing `expect(1).toBe(1)` is discovered and run by `pnpm --filter @hub/web test` (delete it before merging).
- [ ] `pnpm typecheck` still passes (vitest globals typed via `types: ["vitest/globals"]` or explicit imports).

## Files
- `package.json` (root), `vitest.config.mts` and `vitest.shared.mts` (new)
- `packages/shared/package.json`, `packages/shared/vitest.config.ts` (new), `packages/shared/src/policy.test.ts`
- `packages/db/package.json`, `apps/web/package.json`, `apps/admin/package.json` and their new `vitest.config.ts`
- `apps/web/tsconfig.json`, `apps/admin/tsconfig.json` (alias `@/*`)

## Verification
```bash
pnpm install
pnpm test                       # all packages, policy tests green
pnpm --filter @hub/web test     # runs (0 or smoke tests), exit 0
pnpm typecheck
```

## Notes for agents
TDD order: first run `pnpm --filter @hub/web test` and watch it fail with "no test script"; then add config until the smoke test runs. Keep `node:test` out; one runner only. Do not add husky or git hooks; hooks live in `.claude/hooks`.
