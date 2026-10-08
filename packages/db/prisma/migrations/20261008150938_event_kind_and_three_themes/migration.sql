-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('WEDDING', 'ENGAGEMENT', 'BABY_SHOWER', 'BIRTHDAY', 'ANNIVERSARY', 'CEREMONY', 'PARTY', 'CORPORATE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ThemeKey" ADD VALUE 'NURSERY_SAGE';
ALTER TYPE "ThemeKey" ADD VALUE 'TELUGU_TRADITIONAL';
ALTER TYPE "ThemeKey" ADD VALUE 'MIDNIGHT_GALA';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "kind" "EventKind" NOT NULL DEFAULT 'WEDDING';
