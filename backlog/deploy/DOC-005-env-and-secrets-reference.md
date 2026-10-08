---
id: DOC-005
title: Environment variables and secrets reference
labels: [type:chore, area:docs, area:infra, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-DEPLOY
---

## Context
`.env.example` is the only env documentation; `packages/shared/src/env.ts` and `workers/media/hub_worker/config.py` each parse their own subset, and they already disagree on defaults (worker reads `FACE_CLUSTER_DISTANCE`, `FACE_MIN_QUALITY`, `ZIP_PART_BYTES`, `WORKER_*` that `env.ts` does not know). New variables arrive with many tickets (`INTERNAL_API_TOKEN`, `PUBLIC_DERIVATIVE_BASE_URL`, Stripe, SMS, OTel, Sentry).

## Scope
- `docs/deploy/env.md` generated table: variable, consumer(s) (web/admin/worker/prisma), default, required in production, secret?, owner/where it comes from (INF-019, INF-009, INF-011...), notes.
- Generator script `scripts/env-docs.mjs` that parses `env.ts` (zod schema keys and defaults) and `config.py` (`os.getenv("X", default)`) and fails if `.env.example` lacks a key or the doc is stale (`--check` mode wired into `pnpm lint`).
- Secrets handling guidance: never in images, inject via the platform's secret store or `.env.production` with `chmod 600`; rotation procedure for `AUTH_SECRET` (dual-key support ticket noted), `INTERNAL_API_TOKEN`, S3 keys, Stripe keys.
- Production validation: `env()` gains `requiredInProduction` for `AUTH_SECRET` strength (≥ 32 random bytes), `S3_PUBLIC_ENDPOINT`, `EMAIL_PROVIDER != console`, `SMS_PROVIDER` only when SMS features are on; worker `load_settings()` warns on defaults in production (`NODE_ENV`/`APP_ENV=production`).

## Out of scope
- Choosing the secret manager (DOC-006 per provider).

## Acceptance criteria
- [ ] `node scripts/env-docs.mjs --check` passes and fails when a new key is added to `env.ts` without a `.env.example` line.
- [ ] `docs/deploy/env.md` lists every key from both parsers.
- [ ] `env()` throws in production with the dev `AUTH_SECRET` (unit test with `NODE_ENV=production`).

## Files
- `docs/deploy/env.md`, `scripts/env-docs.mjs` (new), `packages/shared/src/env.ts` + test, `workers/media/hub_worker/config.py`, `.env.example`, `package.json`

## Verification
```bash
node scripts/env-docs.mjs --check
pnpm --filter @hub/shared test
```

## Notes for agents
First failing test: production rejects the dev secret. Keep the generator simple (regex over the two files is acceptable); correctness of the check matters more than prettiness.
