/**
 * The data migration that gives every Photo a sortKey (WEB-017): keyset pagination orders by
 * (sortKey, id), so a NULL key would sort last forever. The worker writes
 * `isoformat(timespec="milliseconds")` of capturedAt-or-createdAt; the backfill must produce the
 * same format so old and new rows interleave correctly (see docs/03-data-model.md, "Photo.sortKey").
 *
 * Runs the migration's SQL inside a transaction that is always rolled back, so it never changes
 * rows in whichever database DATABASE_URL points at, and asserts only on rows the test creates
 * (other suites may commit NULL-key photos concurrently). Skipped locally when Postgres is
 * unreachable; fails when CI is set.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./index.ts";

const MIGRATION = new URL("../prisma/migrations/20261008211057_backfill_photo_sortkey/migration.sql", import.meta.url);

const dbUp = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const skipReason = `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`;
const suite = dbUp ? "Photo.sortKey backfill migration" : `Photo.sortKey backfill migration [skipped: ${skipReason}]`;

if (!dbUp && inCi) {
  describe("Photo.sortKey backfill migration", () => {
    it("requires Postgres when CI is set", () => {
      throw new Error(skipReason);
    });
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

/** Create three photos (capturedAt set, unkeyed, already keyed), run the migration `times`, return their keys. */
async function runBackfill(times: number): Promise<Record<string, string | null>> {
  const sql = readFileSync(MIGRATION, "utf8");
  const run = `bf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
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
      for (let i = 0; i < times; i++) await tx.$executeRawUnsafe(sql);
      const rows = await tx.photo.findMany({ where: { eventId: event.id }, select: { id: true, sortKey: true } });
      seen = Object.fromEntries(rows.map((r) => [r.id.slice(run.length + 1), r.sortKey]));
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return seen;
}

describe.skipIf(!dbUp)(suite, () => {
  const expected = { cap: "2026-03-04T05:06:07.089", new: "2026-10-01T12:34:56.789", set: "a0V" };

  it("keys unkeyed photos from capturedAt, else createdAt, in the worker's ISO millisecond format, and leaves keyed photos alone", async () => {
    expect(await runBackfill(1)).toEqual(expected);
  });

  it("is idempotent: a second run changes nothing", async () => {
    expect(await runBackfill(2)).toEqual(expected);
  });
});
