---
id: INF-004
title: GitHub Actions CI with coverage gates and `pnpm verify`
labels: [type:chore, area:infra, priority:p0, size:M, agent-ready]
milestone: Phase 0 — Foundations
depends_on: [INF-001, INF-002, INF-003]
epic: EPIC-QUALITY
---

## Context
There is no `.github/workflows/` directory. docs/04-plan.md Phase 0: "Typecheck, lint, unit tests, Prisma migrate against a throwaway database, and Python tests. GitHub Actions is fine; the workflow only runs containers." `pnpm verify` is what agents must run before a PR (backlog/README.md step 5) and must match CI.

## Scope
- `.github/workflows/ci.yml` triggered on `pull_request` and `push` to `main`. Services: `pgvector/pgvector:pg16` (port 5433) and `rustfs/rustfs:latest` (9000) plus a step creating the `hub-media` bucket with the AWS CLI; Mailpit as a service for e2e.
- Jobs: `ts` (pnpm install with cache, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate` via `prisma migrate deploy`, `pnpm db:seed`, `pnpm test -- --coverage`, `pnpm --filter @hub/web build`, `pnpm --filter @hub/admin build`); `python` (3.13, `pip install -e ".[dev]"`, `make lint`, `make test` against the service Postgres, models downloaded and cached by sha256 via `scripts/download_models.py`); `e2e` (needs `ts`, starts web+admin with `E2E_EXTERNAL_SERVERS=1`, runs `pnpm e2e`, uploads the Playwright report artifact).
- `.env` for CI built from `.env.example` with `sed` for ports.
- Coverage thresholds in `packages/shared/vitest.config.ts` (lines 80 %) and `apps/web/vitest.config.ts` scoped to `src/lib/**` (lines 70 %); fail the run when under.
- Root `verify` script = `pnpm lint && pnpm typecheck && pnpm test && (cd workers/media && make lint && make test)`; keep e2e out of `verify` (too slow locally) but document `pnpm e2e`.
- `.github/pull_request_template.md` with the acceptance-box and "how I verified" sections referenced by backlog/README.md.

## Out of scope
- Deploy workflows (EPIC-DEPLOY). Visual regression snapshots (WEB-013).

## Acceptance criteria
- [ ] A PR that breaks typecheck, lint, a vitest test, a pytest test or the e2e smoke spec shows a red check.
- [ ] CI total wall time under 15 minutes on a cold cache.
- [ ] `pnpm verify` locally and the CI `ts`+`python` jobs run the same commands (document in CONTRIBUTING, DOC-001).
- [ ] Coverage under threshold fails `pnpm test -- --coverage`.

## Files
- `.github/workflows/ci.yml`, `.github/pull_request_template.md` (new)
- `package.json`, `packages/shared/vitest.config.ts`, `apps/web/vitest.config.ts`
- `workers/media/Makefile`, `workers/media/scripts/download_models.py` (cache key)

## Verification
```bash
pnpm verify
act -j ts   # optional, or push a branch and watch the checks
```

## Notes for agents
The worker tests need `DATABASE_URL`; `tests/test_jobs.py` uses the real Postgres. Pin action versions by major. Do not add husky; `.claude/hooks` is the local gate.
