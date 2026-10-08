#!/usr/bin/env node
/**
 * verify-purge: prove that an event's face index was purged (LEG-005).
 *
 *   node scripts/compliance/verify-purge.mjs <eventId> --database <name>
 *
 * Read-only: every statement is a SELECT inside one `SET TRANSACTION READ ONLY` transaction.
 * It connects to exactly the database named on the command line, using host and credentials from
 * DATABASE_URL, and refuses the shared development database `hub`. There is no default database
 * and no environment fallback for the name, so a typo cannot silently check (or, for a future
 * edit of this script, change) the wrong data.
 *
 * Exit codes: 0 every check passed, 1 at least one FAIL, 2 usage error or refusal.
 *
 * What it checks mirrors workers/media/hub_worker/handlers/purge_face_index.py; the runbook
 * (docs/compliance/runbook-biometric-deletion.md) explains each line.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Databases this script will never open, whatever the caller types. Compared lower-cased. */
export const FORBIDDEN_DATABASES = ["hub"];

const DB_NAME = /^[A-Za-z0-9_]{1,63}$/;
const USAGE = "usage: node scripts/compliance/verify-purge.mjs <eventId> --database <name>";

/** @returns {{ok: true, eventId: string, database: string} | {ok: false, error: string}} */
export function parseArgs(argv) {
  let database;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--database") database = argv[++i];
    else if (a.startsWith("--database=")) database = a.slice("--database=".length);
    else if (a.startsWith("--")) return { ok: false, error: `unknown option ${a}` };
    else positional.push(a);
  }
  if (positional.length !== 1) return { ok: false, error: "exactly one eventId is required" };
  if (!database) return { ok: false, error: "--database <name> is required (there is no default)" };
  return { ok: true, eventId: positional[0], database };
}

/** Throws unless `name` is a plain identifier that is not a forbidden database. */
function assertAllowedDatabase(name) {
  if (FORBIDDEN_DATABASES.includes(String(name).trim().toLowerCase())) {
    throw new Error(`refusing database '${name}': it is the shared development database; pass a dedicated one such as hub_t<N>`);
  }
  if (!DB_NAME.test(name)) throw new Error(`invalid database name '${name}': letters, digits and underscore only, at most 63 characters`);
}

/** Take host, port, credentials and options from `baseUrl`; replace only the database name. */
export function resolveDatabaseUrl(baseUrl, database) {
  assertAllowedDatabase(database);
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

const count = async (query, sql, ...params) => Number((await query(sql, params))[0]?.n ?? 0);

/**
 * Run every check for one event. `query(sql, params)` must resolve to an array of row objects;
 * only SELECT statements are issued.
 * @returns {Promise<{ok: boolean, checks: Array<{id: string, status: "PASS"|"FAIL"|"INFO", label: string, detail: string}>}>}
 */
export async function verifyPurge(query, eventId) {
  const checks = [];
  const add = (id, status, label, detail) => checks.push({ id, status, label, detail });
  const [event] = await query(
    `SELECT id, "faceSearchEnabled", "faceIndexPurgeAt", "faceIndexPurgedAt" FROM "Event" WHERE id = $1`,
    [eventId],
  );
  if (!event) {
    add("event", "FAIL", "Event exists", `no event with id ${eventId} in this database`);
    return { ok: false, checks };
  }
  add("event", "PASS", "Event exists", eventId);

  const faces = await count(query, `SELECT count(*)::int AS n FROM "Face" WHERE "eventId" = $1`, eventId);
  add("faces", faces === 0 ? "PASS" : "FAIL", "Face rows (embeddings) for the event", faces === 0 ? "0" : `${faces} remain`);

  const clusters = await count(query, `SELECT count(*)::int AS n FROM "FaceCluster" WHERE "eventId" = $1`, eventId);
  add("clusters", clusters === 0 ? "PASS" : "FAIL", "FaceCluster rows for the event", clusters === 0 ? "0" : `${clusters} remain`);

  const indexed = await count(query, `SELECT count(*)::int AS n FROM "Photo" WHERE "eventId" = $1 AND "facesIndexedAt" IS NOT NULL`, eventId);
  add("photos-reset", indexed === 0 ? "PASS" : "FAIL", "Photos still marked as face-indexed", indexed === 0 ? "0" : `${indexed} photos have facesIndexedAt set`);

  // PROCESS_PHOTO enqueues INDEX_FACES when it finishes, so it rebuilds the index too, unless face search is off.
  const faceSearchOn = event.faceSearchEnabled !== false;
  const pending = await query(
    `SELECT id::text AS id, type, status::text AS status FROM "Job"
      WHERE (type IN ('INDEX_FACES', 'CLUSTER_FACES') OR (type = 'PROCESS_PHOTO' AND $2::boolean))
        AND status IN ('QUEUED', 'RUNNING')
        AND (payload->>'eventId' = $1 OR payload->>'photoId' IN (SELECT id FROM "Photo" WHERE "eventId" = $1))
      ORDER BY id`,
    [eventId, faceSearchOn],
  );
  add(
    "pending-jobs",
    pending.length === 0 ? "PASS" : "FAIL",
    "Queued or running INDEX_FACES / CLUSTER_FACES / PROCESS_PHOTO jobs (would rebuild the index)",
    pending.length === 0 ? "none" : pending.map((j) => `#${j.id} ${j.type} ${j.status}`).join(", "),
  );

  add(
    "face-search",
    faceSearchOn ? "WARN" : "PASS",
    "Event.faceSearchEnabled",
    faceSearchOn ? "on: photos uploaded or reprocessed from now on are embedded again; turn it off first (runbook 1.1)" : "off: INDEX_FACES skips this event",
  );

  const purgedAt = event.faceIndexPurgedAt;
  add("purged-at", purgedAt ? "PASS" : "FAIL", "Event.faceIndexPurgedAt", purgedAt ? asIso(purgedAt) : "NULL (no purge has completed for this event)");

  const [audit] = await query(
    `SELECT id::text AS id, "createdAt", data FROM "AuditLog"
      WHERE "eventId" = $1 AND action = 'faceindex.purge' ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
    [eventId],
  );
  if (audit) {
    const d = audit.data ?? {};
    add("audit", "PASS", "AuditLog 'faceindex.purge' row (newest)", `#${audit.id} at ${asIso(audit.createdAt)}: faces=${d.faces} clusters=${d.clusters} photos=${d.photos} jobId=${d.jobId}`);
  } else {
    add("audit", "FAIL", "AuditLog 'faceindex.purge' row (newest)", "none: the worker writes this row when the purge job completes");
  }

  const matches = await count(
    query,
    `SELECT count(*)::int AS n FROM "PhotoMatch" WHERE "photoId" IN (SELECT id FROM "Photo" WHERE "eventId" = $1)`,
    eventId,
  );
  add("matches", "INFO", "PhotoMatch rows kept (no face data; removed per person on request)", String(matches));

  const consents = await count(query, `SELECT count(*)::int AS n FROM "BiometricConsent" WHERE "eventId" = $1`, eventId);
  add("consents", "INFO", "BiometricConsent rows kept (evidence of consent)", String(consents));

  return { ok: checks.every((c) => c.status !== "FAIL"), checks };
}

const asIso = (v) => (v instanceof Date ? v.toISOString() : String(v));

export function formatReport({ ok, checks }) {
  const lines = checks.map((c) => `${c.status.padEnd(4)}  ${c.label}: ${c.detail}`);
  lines.push(`RESULT: ${ok ? "PASS" : "FAIL"}`);
  lines.push("NOTE  Backups taken before the purge still contain the embeddings until they expire; see docs/ops/backups.md.");
  return lines.join("\n");
}

/**
 * Production connector: Prisma from packages/db, one read-only transaction per run.
 * Prisma's default interactive-transaction timeout is 5 s; the Job payload scan on a large queue
 * can exceed that, so allow two minutes.
 */
export async function connectWithPrisma(url) {
  const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  return {
    transaction: (fn) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          return fn((sql, params = []) => tx.$queryRawUnsafe(sql, ...params));
        },
        { timeout: 120_000, maxWait: 10_000 },
      ),
    close: () => prisma.$disconnect(),
  };
}

/** @returns {Promise<number>} the process exit code */
export async function main(argv, deps = {}) {
  const { env = process.env, log = console.log, connect = connectWithPrisma } = deps;
  const args = parseArgs(argv);
  if (!args.ok) {
    log(`${args.error}\n${USAGE}`);
    return 2;
  }
  try {
    assertAllowedDatabase(args.database);
  } catch (err) {
    log(`Refusing to run: ${err.message}`);
    return 2;
  }
  if (!env.DATABASE_URL) {
    log("DATABASE_URL must be set: it supplies host and credentials only; the database name comes from --database.");
    return 2;
  }
  const url = resolveDatabaseUrl(env.DATABASE_URL, args.database);
  const target = new URL(url);
  log(`Target: database=${args.database} host=${target.host} event=${args.eventId}`);

  const conn = await connect(url);
  try {
    const report = await conn.transaction((query) => verifyPurge(query, args.eventId));
    log(formatReport(report));
    return report.ok ? 0 : 1;
  } finally {
    await conn.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`verify-purge failed: ${err.message}`);
      process.exit(2);
    },
  );
}
