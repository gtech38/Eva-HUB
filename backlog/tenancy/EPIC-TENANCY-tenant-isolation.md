---
id: EPIC-TENANCY
title: Tenant isolation hardening
labels: [type:epic, area:db, priority:p0, size:L]
milestone: Phase 1 — MVP
---

## Context
docs/01-architecture.md §3 promises "all queries go through a Prisma client extension that injects the current tenant scope". What exists is `scoped()` in `packages/db/src/index.ts`, a helper that returns where-fragments and is not used anywhere; every route and action writes `prisma.x.findMany({ where: { eventId } })` by hand. Several tables lack `studioId` (`ZipExport`, `FaceCluster`, `ProofingList`, `Entitlement`). docs/04-plan.md lists tenant leaks as a trust-ending risk and RLS as the Phase 3 defence in depth.

## Children
- DB-001 Schema hardening: `ZipExport.studioId`, `PhotoMatch` CHECK, `FaceCluster` timestamps
- DB-002 Tenant-scoped Prisma client extension
- ADM-002 Migrate web and admin data access to the scoped client
- DB-003 Tenant isolation test suite
- DB-004 Postgres row-level security with session GUC
- ADM-003 Audit coverage for every mutating action

## Definition of Done
- [ ] No `prisma.<eventModel>.find*` call in `apps/**` without an event scope (lint rule or grep check in CI).
- [ ] Isolation suite proves a studio-B principal cannot read or mutate studio-A rows through any route, action or download URL.
- [ ] RLS policies exist for every tenant table and the suite passes with RLS enabled.
- [ ] Every mutating server action writes an `AuditLog` row.
