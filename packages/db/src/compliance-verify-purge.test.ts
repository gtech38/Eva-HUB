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
const skipReason = `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`;
if (!dbUp) console.log(`# packages/db: ${skipReason} -- skipping`);

const statusOf = (checks: Check[], id: string) => checks.find((c) => c.id === id)?.status;

type Fixture = { studioId: string; eventId: string; photoId: string };
const created: Fixture[] = [];

/** An event with one indexed photo, one face, one cluster, one saved match. Optionally purged. */
async function fixture(label: string, opts: { purged?: boolean; reindexedAfterPurge?: boolean; pendingJob?: boolean } = {}) {
  const tag = `${run}-${label}`;
  const f: Fixture = { studioId: `${tag}-studio`, eventId: `${tag}-event`, photoId: `${tag}-photo` };
  created.push(f);
  await prisma.$executeRawUnsafe(`INSERT INTO "Studio"(id, slug, name) VALUES ($1, $1, 'leg005')`, f.studioId);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Event"(id, "studioId", slug, title, theme, "updatedAt") VALUES ($1, $2, $1, '{"en":"leg005"}'::jsonb, 'LUXURY'::"ThemeKey", now())`,
    f.eventId,
    f.studioId,
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
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Job"(type, payload, status, "runAt", "dedupeKey") VALUES ('CLUSTER_FACES', $1::jsonb, 'QUEUED'::"JobStatus", now() + interval '1 hour', $2)`,
      JSON.stringify({ eventId: f.eventId, run }),
      `cluster:${f.eventId}`,
    );
  }
  return f;
}

afterAll(async () => {
  if (dbUp) {
    for (const f of created) {
      await prisma.$executeRawUnsafe(`DELETE FROM "Job" WHERE "dedupeKey" = $1`, `cluster:${f.eventId}`);
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
      ],
    });
    expect(text).toMatch(/^PASS\s+Face rows/m);
    expect(text).toMatch(/^FAIL\s+FaceCluster rows.*3 remain/m);
    expect(text).toMatch(/^INFO\s+PhotoMatch rows kept/m);
    expect(text).toMatch(/RESULT: FAIL/);
    expect(text).toContain("docs/ops/backups.md");
  });
});

describe.skipIf(!dbUp)(dbUp ? "verify-purge against Postgres" : `verify-purge against Postgres [skipped: ${skipReason}]`, () => {
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

  it("fails while a CLUSTER_FACES/INDEX_FACES job for the event is still pending", async () => {
    const f = await fixture("pending", { purged: true, pendingJob: true });
    const result = await verifyPurge(query, f.eventId);
    expect(result.ok).toBe(false);
    expect(statusOf(result.checks, "pending-jobs")).toBe("FAIL");
  });

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
describe.skipIf(!dbUp || FORBIDDEN_DATABASES.includes(dbName.toLowerCase()))(
  dbUp && !FORBIDDEN_DATABASES.includes(dbName.toLowerCase())
    ? "verify-purge CLI"
    : `verify-purge CLI [skipped: DATABASE_URL points at '${dbName}', which the script refuses by design; use a hub_t<N> database]`,
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
