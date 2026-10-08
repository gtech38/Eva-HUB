---
id: DB-004
title: Postgres row-level security with a session GUC
labels: [type:feature, area:db, priority:p2, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [DB-002, DB-003]
epic: EPIC-TENANCY
---

## Context
docs/04-plan.md Phase 3: "Postgres row-level security policies on every tenant table, plus a penetration test focused on tenant isolation." The client extension (DB-002) is application-level; RLS is defence in depth so a missed scope cannot read another studio's rows even through raw SQL.

## Scope
- Migration `enable_rls`: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE` on every table with `studioId`; policy `USING ("studioId" = current_setting('app.studio_id', true))` plus a bypass when `current_setting('app.bypass_rls', true) = 'on'`.
- Two DB roles in `infra/docker-compose.yml` init SQL: `hub_app` (subject to RLS) and `hub_worker`/migrations (`BYPASSRLS`). `DATABASE_URL` for web/admin uses `hub_app`; `WORKER_DATABASE_URL` and the Prisma migrate URL use the bypass role.
- `tenantClient` (DB-002) wraps each query in `$transaction([ $executeRaw\`SELECT set_config('app.studio_id', ${studioId}, true)\`, query ])` or uses an interactive transaction per request (`AsyncLocalStorage`-held).
- Platform-admin pages set `app.bypass_rls`; auth lookups on `User/ContactPoint/Session` are global tables without RLS.
- Worker: `hub_worker/db.py` connects with the bypass role (it legitimately spans tenants per job) and additionally `SET LOCAL app.studio_id` inside handlers that know the event, as a belt-and-braces measure.
- Isolation suite (DB-003) runs twice in CI: with the extension only and with RLS enabled (`RLS=1`).
- `docs/01-architecture.md` §3 "Data isolation" updated.

## Out of scope
- Pen test itself (external). Per-studio database users.

## Acceptance criteria
- [ ] With `DATABASE_URL` as `hub_app` and no GUC set, `SELECT count(*) FROM "Photo"` returns 0 on a seeded DB.
- [ ] With `set_config('app.studio_id', <A>)`, only studio A rows are visible; DB-003 suite passes unchanged.
- [ ] `pnpm db:migrate`, `pnpm db:seed` and the worker tests pass using the bypass role.
- [ ] Connection-pool safety: a vitest test runs two concurrent scoped requests for A and B on the same pool and neither sees the other's rows (proves `set_config(..., true)` is transaction-local).

## Files
- `packages/db/prisma/migrations/<ts>_enable_rls/migration.sql`, `packages/db/src/tenant.ts`
- `infra/docker-compose.yml` (init SQL under `infra/postgres/init/*.sql`), `.env.example`
- `workers/media/hub_worker/db.py`, `docs/01-architecture.md`

## Verification
```bash
pnpm infra:nuke && pnpm infra:up && pnpm db:migrate && pnpm db:seed
psql postgresql://hub_app:hub@localhost:5433/hub -c 'SELECT count(*) FROM "Photo"'   # 0
RLS=1 pnpm e2e --grep isolation
```

## Notes for agents
Write the "0 rows without GUC" test first. Prisma's pool reuses connections, so a `SET` without `LOCAL`/`is_local=true` leaks across requests; the concurrency test exists to catch that.
