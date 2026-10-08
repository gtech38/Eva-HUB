/**
 * Tests for scripts/compliance/verify-purge.mjs (LEG-005), the checker the biometric deletion
 * runbook uses to prove a PURGE_FACE_INDEX happened.
 *
 * Lives in packages/db because this package owns the Postgres test harness and is collected by
 * `pnpm test`; the script itself sits in scripts/ because operators run it from the repo root.
 *
 * The purged fixture replicates the SQL of workers/media/hub_worker/handlers/purge_face_index.py.
 * The real handler is exercised against the same script by
 * workers/media/tests/test_purge_face_index.py, so the two cannot drift silently.
 *
 * DB-backed tests need the local stack (pnpm infra:up) and are skipped, with the reason in the
 * suite name, when Postgres is unreachable. Fixture rows carry a per-run prefix and are removed in
 * afterAll(). The script is read-only; only these fixtures write.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  FORBIDDEN_DATABASES,
  connectWithPrisma,
  formatReport,
  main,
  parseArgs,
  resolveDatabaseUrl,
  verifyPurge,
  type Check,
  type Query,
} from "../../../scripts/compliance/verify-purge.mjs";
import { prisma } from "./index.ts";

const SCRIPT = fileURLToPath(new URL("../../../scripts/compliance/verify-purge.mjs", import.meta.url));
const run = `test-leg005-${Date.now()}`;
const query: Query = (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params);
const vec = `[1,${"0,".repeat(126)}0]`;

const dbUp = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
const dbName = (process.env.DATABASE_URL ?? "").match(/\/([^/?]+)(\?|$)/)?.[1] ?? "";
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
// The Postgres suites insert fixture rows. Never do that in the shared development database `hub`
// (use a dedicated hub_t<N>; CI uses hub_ci). Locally an unusable database skips with the reason in
// the suite name; under CI (the CI env var is set) it is an error, because a skipped end-to-end test
// proves nothing.
const onSharedDb = FORBIDDEN_DATABASES.includes(dbName.toLowerCase());
const skipReason = !dbUp
  ? `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`
  : onSharedDb
    ? `DATABASE_URL points at the shared database '${dbName}'; these suites write fixtures and the script refuses it. Use a dedicated hub_t<N> database`
    : "";
if (process.env.CI && skipReason) throw new Error(`verify-purge tests must run in CI, not skip: ${skipReason}`);
if (skipReason) console.log(`# packages/db: ${skipReason} -- skipping`);
const runDb = skipReason === "";

const statusOf = (checks: Check[], id: string) => checks.find((c) => c.id === id)?.status;

type Fixture = { studioId: string; eventId: string; photoId: string };
const created: Fixture[] = [];

/** An event with one indexed photo, one face, one cluster, one saved match. Optionally purged. */
type FixtureOpts = {
  purged?: boolean;
  reindexedAfterPurge?: boolean;
  pendingJob?: "CLUSTER_FACES" | "INDEX_FACES" | "PROCESS_PHOTO";
  /** Event.faceSearchEnabled; defaults to true like a new event. */
  faceSearch?: boolean;
};

async function fixture(label: string, opts: FixtureOpts = {}) {
  const tag = `${run}-${label}`;
  const f: Fixture = { studioId: `${tag}-studio`, eventId: `${tag}-event`, photoId: `${tag}-photo` };
  created.push(f);
  await prisma.$executeRawUnsafe(`INSERT INTO "Studio"(id, slug, name) VALUES ($1, $1, 'leg005')`, f.studioId);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Event"(id, "studioId", slug, title, theme, "faceSearchEnabled", "updatedAt") VALUES ($1, $2, $1, '{"en":"leg005"}'::jsonb, 'LUXURY'::"ThemeKey", $3, now())`,
    f.eventId,
    f.studioId,
    opts.faceSearch ?? true,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Photo"(id, "studioId", "eventId", "originalKey", "originalBytes", checksum, filename, status, "facesIndexedAt")
     VALUES ($1, $2, $3, 'orig/x.jpg', 0, $1, 'x.jpg', 'READY'::"PhotoStatus", now())`,
    f.photoId,
    f.studioId,
    f.eventId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FaceCluster"(id, "eventId", "updatedAt") VALUES ($1, $2, now())`,
    `${tag}-cluster`,
    f.eventId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Face"(id, "eventId", "photoId", "clusterId", bbox, quality, "modelVersion", embedding)
     VALUES ($1, $2, $3, $4, '{"x":0,"y":0,"w":1,"h":1}'::jsonb, 0.9, 'test', $5::vector)`,
    `${tag}-face`,
    f.eventId,
    f.photoId,
    `${tag}-cluster`,
    vec,
  );
  await prisma.$executeRawUnsafe(`INSERT INTO "User"(id, "updatedAt") VALUES ($1, now())`, `${tag}-user`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PhotoMatch"(id, "photoId", "userId", source, score) VALUES ($1, $2, $3, 'SELFIE'::"MatchSource", 0.9)`,
    `${tag}-match`,
    f.photoId,
    `${tag}-user`,
  );
  if (opts.purged) {
    // Same statements, same order as purge_face_index.py.
    const faces = await prisma.$executeRawUnsafe(`DELETE FROM "Face" WHERE "eventId" = $1`, f.eventId);
    const clusters = await prisma.$executeRawUnsafe(`DELETE FROM "FaceCluster" WHERE "eventId" = $1`, f.eventId);
    const photos = await prisma.$executeRawUnsafe(
      `UPDATE "Photo" SET "facesIndexedAt" = NULL WHERE "eventId" = $1 AND "facesIndexedAt" IS NOT NULL`,
      f.eventId,
    );
    await prisma.$executeRawUnsafe(`UPDATE "Event" SET "faceIndexPurgedAt" = now() WHERE id = $1`, f.eventId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditLog"("studioId", "eventId", action, target, data) VALUES ($1, $2, 'faceindex.purge', $2, $3::jsonb)`,
      f.studioId,
      f.eventId,
      JSON.stringify({ faces, clusters, photos, jobId: 1 }),
    );
  }
  if (opts.reindexedAfterPurge) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Face"(id, "eventId", "photoId", bbox, quality, "modelVersion", embedding)
       VALUES ($1, $2, $3, '{"x":0,"y":0,"w":1,"h":1}'::jsonb, 0.9, 'test', $4::vector)`,
      `${tag}-face2`,
      f.eventId,
      f.photoId,
      vec,
    );
  }
  if (opts.pendingJob) {
    // CLUSTER_FACES carries the event id; INDEX_FACES and PROCESS_PHOTO carry only a photo id.
    const payload = opts.pendingJob === "CLUSTER_FACES" ? { eventId: f.eventId, run } : { photoId: f.photoId, run };
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Job"(type, payload, status, "runAt", "dedupeKey") VALUES ($1, $2::jsonb, 'QUEUED'::"JobStatus", now() + interval '1 hour', $3)`,
      opts.pendingJob,
      JSON.stringify(payload),
      `${run}:${tag}`,
    );
  }
  return f;
}

afterAll(async () => {
  if (runDb) {
    await prisma.$executeRawUnsafe(`DELETE FROM "Job" WHERE "dedupeKey" LIKE $1`, `${run}:%`);
    for (const f of created) {
      await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "eventId" = $1`, f.eventId);
      await prisma.$executeRawUnsafe(`DELETE FROM "PhotoMatch" WHERE "photoId" = $1`, f.photoId);
      await prisma.$executeRawUnsafe(`DELETE FROM "Face" WHERE "eventId" = $1`, f.eventId);
      await prisma.$executeRawUnsafe(`DELETE FROM "FaceCluster" WHERE "eventId" = $1`, f.eventId);
      await prisma.$executeRawUnsafe(`DELETE FROM "Photo" WHERE "eventId" = $1`, f.eventId);
      await prisma.$executeRawUnsafe(`DELETE FROM "Event" WHERE id = $1`, f.eventId);
      await prisma.$executeRawUnsafe(`DELETE FROM "Studio" WHERE id = $1`, f.studioId);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE id LIKE $1`, `${run}-%`);
  }
  await prisma.$disconnect();
});

describe("verify-purge: only ever touches a database named on the command line", () => {
  it("requires --database; a missing name is a usage error, not a default", () => {
    expect(parseArgs(["evt_1"])).toEqual({ ok: false, error: expect.stringContaining("--database") });
    expect(parseArgs(["--database", "hub_t63"])).toEqual({ ok: false, error: expect.stringContaining("eventId") });
    expect(parseArgs(["evt_1", "--database", "hub_t63"])).toEqual({ ok: true, eventId: "evt_1", database: "hub_t63" });
    expect(parseArgs(["--database=hub_t63", "evt_1"])).toEqual({ ok: true, eventId: "evt_1", database: "hub_t63" });
  });

  it("refuses the shared dev database `hub` in any spelling, and anything that is not a plain identifier", () => {
    expect(FORBIDDEN_DATABASES).toContain("hub");
    for (const name of ["hub", "HUB", " hub", "hub "]) {
      expect(() => resolveDatabaseUrl("postgresql://hub:hub@localhost:5433/hub_t1", name)).toThrow(/hub/i);
    }
    // Other spellings of `hub` (quoted, URL-encoded, newline-terminated, fullwidth) are not plain identifiers.
    for (const name of ['"hub"', "'hub'", "%68ub", "hub\n", "ｈｕｂ", "hub%00"]) {
      expect(() => resolveDatabaseUrl("postgresql://hub:hub@localhost:5433/hub_t1", name)).toThrow();
    }
    for (const name of ["", "a/b", "hub_t1?sslmode=disable", "x y", "x;drop", "../hub"]) {
      expect(() => resolveDatabaseUrl("postgresql://hub:hub@localhost:5433/hub_t1", name)).toThrow();
    }
  });

  it("swaps only the database name and keeps credentials, host and options", () => {
    expect(resolveDatabaseUrl("postgresql://u:p%40ss@db.internal:5433/hub?schema=public", "hub_t63")).toBe(
      "postgresql://u:p%40ss@db.internal:5433/hub_t63?schema=public",
    );
  });

  it("main() never connects when the database is missing or forbidden", async () => {
    const connect = vi.fn();
    const out: string[] = [];
    const deps = { connect, log: (s: string) => out.push(s), env: { DATABASE_URL: "postgresql://hub:hub@localhost:5433/hub" } };
    expect(await main(["evt_1"], deps)).toBe(2);
    expect(await main(["evt_1", "--database", "hub"], deps)).toBe(2);
    expect(await main(["evt_1", "--database", "HUB"], deps)).toBe(2);
    expect(connect).not.toHaveBeenCalled();
    expect(out.join("\n")).toMatch(/refus/i);
  });

  it("main() needs DATABASE_URL for host and credentials, and says so", async () => {
    const connect = vi.fn();
    const out: string[] = [];
    expect(await main(["evt_1", "--database", "hub_t63"], { connect, log: (s: string) => out.push(s), env: {} })).toBe(2);
    expect(connect).not.toHaveBeenCalled();
    expect(out.join("\n")).toMatch(/DATABASE_URL/);
  });
});

describe("verify-purge: report", () => {
  it("an unknown event is a FAIL, not a crash", async () => {
    const calls: string[] = [];
    const result = await verifyPurge(async (sql) => {
      calls.push(sql);
      return [];
    }, "no-such-event");
    expect(result.ok).toBe(false);
    expect(statusOf(result.checks, "event")).toBe("FAIL");
    expect(calls.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });

  it("formatReport prints one PASS/FAIL/INFO line per check and a verdict, and points at the backup caveat", () => {
    const text = formatReport({
      ok: false,
      checks: [
        { id: "faces", status: "PASS", label: "Face rows", detail: "0" },
        { id: "clusters", status: "FAIL", label: "FaceCluster rows", detail: "3 remain" },
        { id: "matches", status: "INFO", label: "PhotoMatch rows kept", detail: "2" },
        { id: "face-search", status: "WARN", label: "Face search enabled", detail: "on" },
      ],
    });
    expect(text).toMatch(/^WARN\s+Face search enabled/m);
    expect(text).toMatch(/^PASS\s+Face rows/m);
    expect(text).toMatch(/^FAIL\s+FaceCluster rows.*3 remain/m);
    expect(text).toMatch(/^INFO\s+PhotoMatch rows kept/m);
    expect(text).toMatch(/RESULT: FAIL/);
    expect(text).toContain("docs/ops/backups.md");
  });
});

describe.skipIf(!runDb)(runDb ? "verify-purge against Postgres" : `verify-purge against Postgres [skipped: ${skipReason}]`, () => {
  it("reports FAIL for an event whose face index has not been purged", async () => {
    const f = await fixture("unpurged");
    const result = await verifyPurge(query, f.eventId);
    expect(result.ok).toBe(false);
    expect(statusOf(result.checks, "faces")).toBe("FAIL");
    expect(statusOf(result.checks, "clusters")).toBe("FAIL");
    expect(statusOf(result.checks, "photos-reset")).toBe("FAIL");
    expect(statusOf(result.checks, "purged-at")).toBe("FAIL");
    expect(statusOf(result.checks, "audit")).toBe("FAIL");
  });

  it("reports PASS for an event after PURGE_FACE_INDEX ran, and shows the audit counts and surviving matches", async () => {
    const f = await fixture("purged", { purged: true });
    const result = await verifyPurge(query, f.eventId);
    expect(result.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(result.ok).toBe(true);
    const audit = result.checks.find((c) => c.id === "audit");
    expect(audit?.status).toBe("PASS");
    expect(audit?.detail).toMatch(/faces=1/);
    expect(audit?.detail).toMatch(/clusters=1/);
    const matches = result.checks.find((c) => c.id === "matches");
    expect(matches?.status).toBe("INFO");
    expect(matches?.detail).toMatch(/1/);
  });

  it("fails when faces were re-indexed after the purge, even though the purge stamp and audit row exist", async () => {
    const f = await fixture("reindexed", { purged: true, reindexedAfterPurge: true });
    const result = await verifyPurge(query, f.eventId);
    expect(result.ok).toBe(false);
    expect(statusOf(result.checks, "faces")).toBe("FAIL");
    expect(statusOf(result.checks, "purged-at")).toBe("PASS");
    expect(statusOf(result.checks, "audit")).toBe("PASS");
  });

  it.each(["CLUSTER_FACES", "INDEX_FACES", "PROCESS_PHOTO"] as const)(
    "fails while a queued %s job for the event would rebuild the index (matched by event id or by photo id)",
    async (type) => {
      const f = await fixture(`pending-${type}`, { purged: true, pendingJob: type });
      const result = await verifyPurge(query, f.eventId);
      expect(result.ok).toBe(false);
      expect(statusOf(result.checks, "pending-jobs")).toBe("FAIL");
    },
  );

  it("a queued PROCESS_PHOTO is harmless once face search is off (INDEX_FACES would skip)", async () => {
    const f = await fixture("pp-off", { purged: true, pendingJob: "PROCESS_PHOTO", faceSearch: false });
    const result = await verifyPurge(query, f.eventId);
    expect(statusOf(result.checks, "pending-jobs")).toBe("PASS");
    expect(result.ok).toBe(true);
  });

  it("warns, without failing, while face search is still on: new uploads would be embedded again", async () => {
    const on = await verifyPurge(query, (await fixture("fs-on", { purged: true })).eventId);
    expect(statusOf(on.checks, "face-search")).toBe("WARN");
    expect(on.ok).toBe(true);
    const off = await verifyPurge(query, (await fixture("fs-off", { purged: true, faceSearch: false })).eventId);
    expect(statusOf(off.checks, "face-search")).toBe("PASS");
  });

  it("the production connector is read-only: an INSERT inside its transaction is rejected", async () => {
    const conn = await connectWithPrisma(resolveDatabaseUrl(process.env.DATABASE_URL!, dbName));
    try {
      await expect(
        conn.transaction((q) => q(`INSERT INTO "Studio"(id, slug, name) VALUES ('${run}-ro', '${run}-ro', 'x')`)),
      ).rejects.toThrow(/read-only/i);
      const [row] = await query(`SELECT count(*)::int AS n FROM "Studio" WHERE id = $1`, [`${run}-ro`]);
      expect(row.n).toBe(0);
    } finally {
      await conn.close();
    }
  });

  it("the production connector outlasts Prisma's 5 s default transaction timeout (the Job payload scan can be slow)", async () => {
    const conn = await connectWithPrisma(resolveDatabaseUrl(process.env.DATABASE_URL!, dbName));
    try {
      const rows = await conn.transaction((q) => q(`SELECT pg_sleep(5.5)::text AS slept, 1 AS one`));
      expect(rows[0].one).toBe(1);
    } finally {
      await conn.close();
    }
  }, 20_000);

  it("an audit row left by an earlier purge does not vouch for a purge that has not completed", async () => {
    const f = await fixture("stale-audit-no-stamp", { purged: true });
    await prisma.$executeRawUnsafe(`UPDATE "Event" SET "faceIndexPurgedAt" = NULL WHERE id = $1`, f.eventId);
    const result = await verifyPurge(query, f.eventId);
    expect(statusOf(result.checks, "purged-at")).toBe("FAIL");
    expect(statusOf(result.checks, "audit")).toBe("FAIL");
    expect(result.ok).toBe(false);
  });

  it("an audit row older than the purge stamp is not the record of that purge", async () => {
    const f = await fixture("stale-audit-old", { purged: true });
    await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "createdAt" = now() - interval '1 hour' WHERE "eventId" = $1`, f.eventId);
    const result = await verifyPurge(query, f.eventId);
    expect(statusOf(result.checks, "audit")).toBe("FAIL");
    expect(result.ok).toBe(false);
  });

  it.each(["INDEX_FACES", "PROCESS_PHOTO"] as const)(
    "warns about a DEAD %s job for the event: admin 'Retry dead' would revive it and rebuild the index",
    async (type) => {
      const f = await fixture(`dead-${type}`, { purged: true });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Job"(type, payload, status, "dedupeKey") VALUES ($1, $2::jsonb, 'DEAD'::"JobStatus", $3)`,
        type,
        JSON.stringify({ photoId: f.photoId, run }),
        `${run}:dead-${type}`,
      );
      const result = await verifyPurge(query, f.eventId);
      expect(statusOf(result.checks, "dead-jobs")).toBe("WARN");
      expect(result.ok).toBe(true);
    },
  );

  it("only ever issues SELECT statements", async () => {
    const f = await fixture("readonly", { purged: true });
    const seen: string[] = [];
    await verifyPurge((sql, params) => {
      seen.push(sql);
      return query(sql, params);
    }, f.eventId);
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.filter((s) => !/^\s*SELECT\b/i.test(s))).toEqual([]);
  });
});

// The CLI proper: spawn the script against the database this suite is already using. Never against `hub`.
describe.skipIf(!runDb)(
  runDb ? "verify-purge CLI" : `verify-purge CLI [skipped: ${skipReason}]`,
  () => {
    const cli = (eventId: string) =>
      spawnSync(process.execPath, [SCRIPT, eventId, "--database", dbName], { encoding: "utf8", env: process.env });

    it("exits 0 and prints PASS lines for a purged event", async () => {
      const f = await fixture("cli-purged", { purged: true });
      const r = cli(f.eventId);
      expect(r.stdout).toMatch(/RESULT: PASS/);
      expect(r.status).toBe(0);
    });

    it("exits 1 and prints FAIL lines for an un-purged event", async () => {
      const f = await fixture("cli-unpurged");
      const r = cli(f.eventId);
      expect(r.stdout).toMatch(/^FAIL\s+/m);
      expect(r.stdout).toMatch(/RESULT: FAIL/);
      expect(r.status).toBe(1);
    });

    it("refuses `hub` as a subprocess too", () => {
      const r = spawnSync(process.execPath, [SCRIPT, "evt", "--database", "hub"], { encoding: "utf8", env: process.env });
      expect(r.status).toBe(2);
    });
  },
);
