---
id: EPIC-QUALITY
title: Test infrastructure and CI
labels: [type:epic, area:infra, priority:p0, size:L]
milestone: Phase 0 — Foundations
---

## Context
When this epic was written, the only automated tests were `packages/shared/src/policy.test.ts` (then on node:test; INF-001 moved every TS package to vitest) and 21 pytest cases in `workers/media/tests`. Neither Next app has a test runner, there is no CI, no ESLint config (`next lint` has never been configured; `apps/admin/next.config.ts` sets `eslint.ignoreDuringBuilds`), and `pnpm verify` runs only typecheck + unit + pytest. docs/04-plan.md Phase 0 calls for CI with typecheck, lint, unit, migrate and Python tests. Every later ticket in this backlog names a failing test to write first, so this epic unblocks all of them.

## Children
- INF-001 Vitest workspace for shared, db, web and admin
- INF-002 ESLint and Prettier configuration
- INF-003 Playwright e2e harness against the local stack
- INF-004 GitHub Actions CI with coverage gates and `pnpm verify`
- SHR-001 First unit tests: shared auth helpers and web gallery rules
- WEB-001 e2e: guest sign-in, RSVP and gallery
- ADM-001 e2e: admin sign-in and event creation
- DOC-001 CONTRIBUTING.md including the `.claude/hooks` TDD gate
- WRK-011 Fix flaky consumer tests on CI
- WRK-015 Default job runAt from the database clock
- WRK-016 Scope requeue_stale() by job type

## Definition of Done
- [ ] `pnpm verify` runs lint, typecheck, vitest (all packages), pytest and exits non-zero on any failure.
- [ ] CI runs on every PR and on `main`, with Postgres+pgvector and RustFS as services, and runs migrate, seed, typecheck, lint, unit, pytest, Next builds and Playwright e2e.
- [ ] Coverage thresholds are enforced for `packages/shared` and `apps/web/src/lib`.
- [ ] CONTRIBUTING.md documents the branch, TDD and hook rules from `backlog/README.md`.
