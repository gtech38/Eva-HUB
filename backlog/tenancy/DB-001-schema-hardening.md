---
id: DB-001
title: Schema hardening: ZipExport.studioId, PhotoMatch CHECK constraint, FaceCluster timestamps
labels: [type:tech-debt, area:db, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-TENANCY
---

## Context
Three gaps between `docs/03-data-model.md` and `packages/db/prisma/migrations/20261007200507_init/migration.sql`: the documented `CHECK (num_nonnulls("userId","subjectGuestId") = 1)` on `PhotoMatch` was never written (the schema only has a comment), `ZipExport` has no `studioId` so the storage key `s/{studioId}/e/{eventId}/zip/...` cannot be derived from the row alone, and `FaceCluster` has no `createdAt/updatedAt` so cluster churn cannot be inspected.

## Scope
- Prisma schema: add `studioId String` to `ZipExport` (+ `@@index([eventId, scopeHash])`), `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` to `FaceCluster`.
- Migration `add_tenant_columns_and_checks`: add columns with a backfill (`UPDATE "ZipExport" z SET "studioId" = e."studioId" FROM "Event" e WHERE e.id = z."eventId"`), then `SET NOT NULL`; add the `PhotoMatch` CHECK via raw SQL in the same migration; backfill `FaceCluster.updatedAt = now()`.
- Worker: `cluster_faces.py` inserts must set `"createdAt","updatedAt"` (Prisma `@updatedAt` is client-side only); `build_zip.py` reads `studioId` from `ZipExport` instead of joining `Event`.
- Seed unaffected.

## Out of scope
- `studioId` on `ProofingList`/`Entitlement` (done in DB-002 if the extension needs it). RLS (DB-004).

## Acceptance criteria
- [ ] `pnpm db:migrate` applies cleanly on a seeded database and on an empty one.
- [ ] `INSERT INTO "PhotoMatch" (...) VALUES (... userId=NULL, subjectGuestId=NULL ...)` fails with a check-constraint error; same for both set.
- [ ] `cd workers/media && make test` passes; a new test in `tests/test_jobs.py` inserts a `FaceCluster` through the handler path and asserts `updatedAt IS NOT NULL`.
- [ ] `prisma migrate diff` from schema to database is empty.

## Files
- `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<ts>_add_tenant_columns_and_checks/migration.sql`
- `workers/media/hub_worker/handlers/cluster_faces.py`, `workers/media/hub_worker/handlers/build_zip.py`, `workers/media/tests/test_jobs.py`

## Verification
```bash
pnpm db:migrate && pnpm db:seed
psql "$DATABASE_URL" -c 'INSERT INTO "PhotoMatch"(id,"photoId",source,score) VALUES ('"'"'x'"'"','"'"'y'"'"','"'"'SELFIE'"'"',0.5)'   # must fail
cd workers/media && make test
```

## Notes for agents
Write the failing pytest first (cluster row without timestamps). `prisma migrate dev --create-only` then hand-edit the SQL for the backfill and CHECK; Prisma cannot express CHECK constraints.
