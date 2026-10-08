-- DB-001 schema hardening. Hand-edited after `prisma migrate dev --create-only`:
-- required columns are added nullable, backfilled, then made NOT NULL, and the
-- PhotoMatch CHECK (which Prisma cannot express) is raw SQL.

-- FaceCluster timestamps. Prisma's @updatedAt is client-side only, so there is no
-- column default: raw-SQL writers (workers/media cluster_faces.py) set it explicitly.
ALTER TABLE "FaceCluster" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "FaceCluster" SET "updatedAt" = now() WHERE "updatedAt" IS NULL;
ALTER TABLE "FaceCluster" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ZipExport.studioId so the storage key s/{studioId}/e/{eventId}/zip/... derives from
-- the row alone. Backfilled from Event; a row whose event no longer exists stays NULL
-- and makes SET NOT NULL fail loudly rather than inventing a tenant for it.
ALTER TABLE "ZipExport" ADD COLUMN "studioId" TEXT;
UPDATE "ZipExport" z SET "studioId" = e."studioId" FROM "Event" e WHERE e.id = z."eventId";
ALTER TABLE "ZipExport" ALTER COLUMN "studioId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ZipExport_eventId_scopeHash_idx" ON "ZipExport"("eventId", "scopeHash");

-- A match has exactly one subject: a user (adult) or a guest row (child searched by a guardian).
ALTER TABLE "PhotoMatch" ADD CONSTRAINT "PhotoMatch_one_subject"
  CHECK (num_nonnulls("userId", "subjectGuestId") = 1);
