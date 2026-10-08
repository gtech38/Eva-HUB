/**
 * Postgres-backed tests for the job-queue helper (`enqueue()` dedupe semantics, which must
 * match workers/media/hub_worker/jobs.py). Needs the local stack (pnpm infra:up); when Postgres
 * is unreachable every test is skipped with a message instead of failing.
 *
 * Isolation from a live worker: rows use a type no production handler knows (`TEST_NOOP`, the
 * same name the worker's own tests use) AND a runAt one hour in the future, so the claim query
 * (`status='QUEUED' AND "runAt" <= now()`) can never pick them up mid-test. Every payload carries
 * the per-run marker and every dedupeKey the per-run prefix; `after()` deletes by both.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enqueue, prisma, type JobType } from "./index.ts";

const T = "TEST_NOOP" as JobType;
const run = `test-${Date.now()}`;
const key = (s: string) => `${run}:${s}`;
const HOUR = 3_600_000;
const future = (offsetMs = 0) => new Date(Date.now() + HOUR + offsetMs);

const dbUp = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const skip = dbUp ? false : `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`;
if (skip) console.log(`# packages/db: ${skip}`);

after(async () => {
  if (dbUp) {
    await prisma.job.deleteMany({
      where: { OR: [{ dedupeKey: { startsWith: run } }, { payload: { path: ["run"], equals: run } }] },
    });
  }
  await prisma.$disconnect();
});

test("enqueue without dedupeKey always creates a new QUEUED job", { skip }, async () => {
  const a = await enqueue(T, { run, n: 1 }, { runAt: future() });
  let b: { id: bigint } | undefined;
  try {
    b = await enqueue(T, { run, n: 2 }, { runAt: future() });
    assert.notEqual(a.id, b.id);
    assert.equal(a.status, "QUEUED");
  } finally {
    await prisma.job.deleteMany({ where: { id: { in: [a.id, ...(b ? [b.id] : [])] } } });
  }
});

test("enqueue with dedupeKey coalesces while QUEUED: payload refreshed, runAt = later of the two, attempts kept", { skip }, async () => {
  const early = future(0);
  const late = future(60_000);
  const a = await enqueue(T, { run, eventId: "e1" }, { dedupeKey: key("cluster"), runAt: late });
  await prisma.job.update({ where: { id: a.id }, data: { attempts: 2 } });

  const b = await enqueue(T, { run, eventId: "e1", again: true }, { dedupeKey: key("cluster"), runAt: early });
  assert.equal(b.id, a.id, "same row reused");
  assert.deepEqual(b.payload, { run, eventId: "e1", again: true });
  assert.equal(b.runAt.getTime(), late.getTime(), "an earlier request does not pull runAt forward (GREATEST)");
  assert.equal(b.attempts, 2, "attempts are kept while QUEUED");

  const later = future(120_000);
  const c = await enqueue(T, { run, eventId: "e1" }, { dedupeKey: key("cluster"), runAt: later });
  assert.equal(c.id, a.id);
  assert.equal(c.runAt.getTime(), later.getTime(), "a later request pushes runAt back (GREATEST)");
});

test("enqueue with dedupeKey resets a SUCCEEDED job back to QUEUED with the new runAt and attempts 0", { skip }, async () => {
  const a = await enqueue(T, { run, photoId: "p1" }, { dedupeKey: key("process"), runAt: future() });
  const farFuture = future(10 * HOUR);
  await prisma.job.update({
    where: { id: a.id },
    data: { status: "SUCCEEDED", attempts: 3, lastError: "old", runAt: farFuture, lockedBy: "w1", lockedAt: new Date() },
  });

  const next = future(0);
  const b = await enqueue(T, { run, photoId: "p1", v: 2 }, { dedupeKey: key("process"), runAt: next });
  assert.equal(b.id, a.id);
  assert.equal(b.status, "QUEUED");
  assert.equal(b.attempts, 0, "attempts reset when the row was not QUEUED");
  assert.equal(b.lastError, null);
  assert.equal(b.lockedBy, null);
  assert.equal(b.lockedAt, null);
  assert.equal(b.runAt.getTime(), next.getTime(), "new runAt wins when the row was not QUEUED (no GREATEST)");
  assert.deepEqual(b.payload, { run, photoId: "p1", v: 2 });
});

test("enqueue with dedupeKey leaves a RUNNING job untouched", { skip }, async () => {
  const a = await enqueue(T, { run, zipExportId: "z1" }, { dedupeKey: key("zip"), runAt: future() });
  await prisma.job.update({ where: { id: a.id }, data: { status: "RUNNING", lockedBy: "w1", lockedAt: new Date() } });
  const b = await enqueue(T, { run, zipExportId: "z1", changed: true }, { dedupeKey: key("zip"), runAt: future() });
  assert.equal(b.id, a.id);
  assert.equal(b.status, "RUNNING");
  assert.equal(b.lockedBy, "w1");
  assert.deepEqual(b.payload, { run, zipExportId: "z1" }, "payload not overwritten mid-run");
});
