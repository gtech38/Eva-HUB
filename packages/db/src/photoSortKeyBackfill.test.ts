/**
 * The data migration that gives every Photo a sortKey (WEB-017): keyset pagination orders by
 * (sortKey, id), so a NULL key would sort last forever. The worker writes
 * `isoformat(timespec="milliseconds")` of capturedAt-or-createdAt; the backfill must produce the
 * same format so old and new rows interleave correctly.
 *
 * Runs the migration's SQL inside a transaction that is always rolled back, so it never changes
 * rows in whichever database DATABASE_URL points at. Skipped when Postgres is unreachable.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./index.ts";

const MIGRATION = new URL("../prisma/migrations/20261009090000_backfill_photo_sortkey/migration.sql", import.meta.url);

const dbUp = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const suite = dbUp ? "Photo.sortKey backfill migration" : `Photo.sortKey backfill migration [skipped: Postgres unreachable at ${dbHost}; run pnpm infra:up]`;

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

describe.skipIf(!dbUp)(suite, () => {
  it("keys unkeyed photos from capturedAt, else createdAt, in the worker's ISO millisecond format, and leaves keyed photos alone", async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const run = `bf${Date.now().toString(36)}`;
    let seen: Record<string, string | null> = {};
    try {
      await prisma.$transaction(async (tx) => {
        const studio = await tx.studio.create({ data: { slug: `${run}-s`, name: run } });
        const event = await tx.event.create({ data: { studioId: studio.id, slug: `${run}-e`, title: { en: run }, theme: "LUXURY" } });
        const base = { studioId: studio.id, eventId: event.id, originalBytes: BigInt(1), status: "READY" as const };
        await tx.photo.createMany({
          data: [
            { ...base, id: `${run}-cap`, originalKey: "k1", checksum: "c1", filename: "a.jpg", capturedAt: new Date("2026-03-04T05:06:07.089Z"), createdAt: new Date("2026-10-01T00:00:00.000Z") },
            { ...base, id: `${run}-new`, originalKey: "k2", checksum: "c2", filename: "b.jpg", createdAt: new Date("2026-10-01T12:34:56.789Z") },
            { ...base, id: `${run}-set`, originalKey: "k3", checksum: "c3", filename: "c.jpg", sortKey: "a0V", createdAt: new Date("2026-10-01T00:00:00.000Z") },
          ],
        });
        await tx.$executeRawUnsafe(sql);
        const rows = await tx.photo.findMany({ where: { eventId: event.id }, select: { id: true, sortKey: true } });
        seen = Object.fromEntries(rows.map((r) => [r.id.slice(run.length + 1), r.sortKey]));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(seen).toEqual({ cap: "2026-03-04T05:06:07.089", new: "2026-10-01T12:34:56.789", set: "a0V" });
  });

  it("leaves no photo without a sortKey after it runs", async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    let remaining = -1;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        remaining = await tx.photo.count({ where: { sortKey: null } });
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(remaining).toBe(0);
  });
});
