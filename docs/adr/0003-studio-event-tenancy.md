# ADR-0003: Studio to Event tenancy with studioId on tenant rows; RLS deferred to Phase 3

- Status: Accepted
- Date: 2026-10-08
- Tickets: DB-001, DB-002, DB-003, DB-004, ADM-002, DOC-009

## Context

The platform is built for one studio first but must be able to host other photographers without a rewrite (docs/01 section 3, docs/03). Cross-tenant leakage is the highest-impact failure in SaaS mode (docs/04 risks). Isolation has to be enforceable now without slowing the single-studio MVP.

## Decision

One platform, one database, one schema. The hierarchy is Studio, then Event, then SubEvent. Every tenant-owned table carries `studioId`, and event-owned tables also carry `eventId` (convention at the top of `schema.prisma`; for example `ZipExport.studioId` exists so storage keys derive from the row alone). Application code scopes every query: `scoped({ studioId, eventId })` in `@hub/db` returns where-fragments (`whereEvent`, `whereEventOnly`, `whereStudio`) and makes a missing `eventId` a type error for event tables; authorisation is separate and only via `can()`. `PLATFORM_ADMIN` and `STUDIO_OWNER` stay distinct roles. Postgres row-level security is not enabled in the POC; it is a Phase 3 item, to be added with a penetration test before a second studio joins.

## Consequences

- Isolation depends on discipline today: a forgotten `where` leaks. The post-edit hook flags unscoped `findMany()`, but it is advisory.
- Raw SQL (the Python worker, `$queryRaw`) bypasses the helper and must filter by hand.
- Follow-ups close the gap in order: DB-001 schema hardening, DB-002 a Prisma client extension that injects scope, ADM-002 move both apps onto it, DB-003 an isolation test suite, DOC-009 a pentest checklist, DB-004 RLS with a session GUC (Phase 3).
- Per docs/04, RLS and a tenant-isolation pentest (DB-004, DOC-009) gate onboarding any outside studio.

## Alternatives

- Database or schema per studio: contradicts the "one platform and one database" decision in the README and makes platform-wide queries and migrations harder.
- RLS from day one: the strongest guarantee, but needs a per-request session variable (DB-004 proposes a GUC) across Prisma and the worker, which the POC does not have; docs/01 section 3 defers it to before outside studios sign on.

## References

- `packages/db/prisma/schema.prisma`
- `packages/db/src/index.ts`
- `packages/shared/src/policy.ts`
- `docs/03-data-model.md` decision 13
- `docs/04-plan.md` Phase 3
