-- DB-001 schema hardening. Hand-edited after `prisma migrate dev --create-only`:
-- required columns are added nullable, backfilled, then made NOT NULL, and the
-- PhotoMatch CHECK (which Prisma cannot express) is raw SQL.

-- Pre-flight: refuse to start on data this migration cannot fix by itself, before any
-- DDL runs, with a message that says what to clean up. Recovery after fixing the data:
--   pnpm exec prisma migrate resolve --rolled-back 20261008172404_add_tenant_columns_and_checks
--   pnpm exec prisma migrate deploy
DO $$
DECLARE
  orphan_zips   integer;
  both_subjects integer;
BEGIN
  SELECT count(*) INTO orphan_zips
    FROM "ZipExport" z WHERE NOT EXISTS (SELECT 1 FROM "Event" e WHERE e.id = z."eventId");
  SELECT count(*) INTO both_subjects
    FROM "PhotoMatch" WHERE "userId" IS NOT NULL AND "subjectGuestId" IS NOT NULL;
  IF orphan_zips > 0 OR both_subjects > 0 THEN
    RAISE EXCEPTION 'DB-001: % ZipExport row(s) reference a missing Event (no studioId to backfill) and % PhotoMatch row(s) have both userId and subjectGuestId; fix or delete them, then rerun',
      orphan_zips, both_subjects;
  END IF;
END $$;

-- FaceCluster timestamps. Prisma's @updatedAt is client-side only, so there is no
-- column default: raw-SQL writers (workers/media cluster_faces.py) set it explicitly.
-- Existing rows get the migration time for both columns; their real creation time is unknown.
ALTER TABLE "FaceCluster" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "FaceCluster" SET "updatedAt" = now() WHERE "updatedAt" IS NULL;
ALTER TABLE "FaceCluster" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ZipExport.studioId so the storage key s/{studioId}/e/{eventId}/zip/... derives from
-- the row alone. Backfilled from Event (the pre-flight guarantees every row has one).
ALTER TABLE "ZipExport" ADD COLUMN "studioId" TEXT;
UPDATE "ZipExport" z SET "studioId" = e."studioId" FROM "Event" e WHERE e.id = z."eventId";
ALTER TABLE "ZipExport" ALTER COLUMN "studioId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ZipExport_eventId_scopeHash_idx" ON "ZipExport"("eventId", "scopeHash");

-- A match has exactly one subject: a user (adult) or a guest row (child searched by a guardian).
-- Subject-less rows (left by the old ON DELETE SET NULL on userId) match nobody: drop them.
DELETE FROM "PhotoMatch" WHERE "userId" IS NULL AND "subjectGuestId" IS NULL;
ALTER TABLE "PhotoMatch" ADD CONSTRAINT "PhotoMatch_one_subject"
  CHECK (num_nonnulls("userId", "subjectGuestId") = 1);

-- Deleting a user deletes their matches; SET NULL would leave a row the CHECK rejects.
-- DropForeignKey
ALTER TABLE "PhotoMatch" DROP CONSTRAINT "PhotoMatch_userId_fkey";

-- AddForeignKey
ALTER TABLE "PhotoMatch" ADD CONSTRAINT "PhotoMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
