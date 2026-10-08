# ADR-0003: Studio to Event tenancy with studioId on tenant rows; RLS deferred to Phase 3

- Status: Accepted
- Date: 2026-10-08
- Tickets: DB-002, DB-003, DB-004, ADM-002, DOC-009

## Context

The platform is built for one studio first but must be able to host other photographers without a rewrite (docs/01 section 3, docs/03). Cross-tenant leakage is the highest-impact failure in SaaS mode (docs/04 risks). Isolation has to be enforceable later without slowing the single-studio MVP.

## Decision

One platform, one database, one schema. The hierarchy is Studio, then Event, then SubEvent. Every tenant-owned table carries `studioId`, and event-owned tables also carry `eventId` (convention at the top of `schema.prisma`; `ZipExport.studioId` exists so storage keys derive from the row alone). Today scoping is done by hand: each query writes its own `where` on `eventId` and `studioId`. `scoped()` in `@hub/db` exists but has no callers and does not enforce anything: with no `eventId` it spreads nothing, and `undefined as never` compiles (DB-002 records this). The only automated check is the advisory post-edit hook that flags `findMany()`, `findFirst()`, `count()`, `updateMany()` or `deleteMany()` called with no arguments. Authorisation is separate and only via `can()`; `PLATFORM_ADMIN` and `STUDIO_OWNER` stay distinct roles. Postgres row-level security is not enabled in the POC; it is a Phase 3 item.

## Consequences

- Isolation depends on discipline today: a forgotten `where` leaks, and nothing fails.
- Raw SQL (the Python worker, `$queryRaw`) bypasses any client-side scope and must filter by hand.
- Follow-ups close the gap in order: DB-002 a Prisma client extension that injects scope and throws without `eventId`, ADM-002 move both apps onto it, DB-003 an isolation test suite, DOC-009 a pentest checklist, DB-004 RLS with a session GUC (Phase 3).
- Per docs/04, RLS and a tenant-isolation pentest (DB-004, DOC-009) gate onboarding any outside studio.

## Alternatives

- Database or schema per studio: contradicts the "one platform and one database" decision in the README and makes platform-wide queries and migrations harder.
- RLS from day one: the strongest guarantee, but needs a per-request session variable (DB-004 proposes a GUC) across Prisma and the worker, which the POC does not have; docs/01 section 3 defers it to before outside studios sign on.

## References

- `packages/db/prisma/schema.prisma`
- `packages/db/src/index.ts`
- `packages/shared/src/policy.ts`
- `.claude/hooks/post_edit_check.py`
- `docs/03-data-model.md` decision 13
- `docs/04-plan.md` Phase 3
