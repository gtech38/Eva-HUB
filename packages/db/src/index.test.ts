/**
 * Postgres-backed tests for the job-queue helper (`enqueue()` dedupe semantics, which must
 * match workers/media/hub_worker/jobs.py). Needs the local stack (pnpm infra:up); when Postgres
 * is unreachable every test is skipped with a message instead of failing.
 *
 * Isolation from a live worker: rows use a type no production handler knows (`TEST_NOOP`, the
 * same name the worker's own tests use) AND a runAt one hour in the future, so the claim query
 * (`status='QUEUED' AND "runAt" <= now()`) can never pick them up mid-test. Every payload carries
 * the per-run marker and every dedupeKey the per-run prefix; `afterAll()` deletes by both.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
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
const skipReason = `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`;
if (!dbUp) console.log(`# packages/db: ${skipReason} -- skipping`);
// The reason is in the suite name too: vitest's compact/agent reporters drop console output of skipped files.
const suite = dbUp ? "enqueue() against Postgres" : `enqueue() against Postgres [skipped: ${skipReason}]`;

afterAll(async () => {
  if (dbUp) {
    await prisma.job.deleteMany({
      where: { OR: [{ dedupeKey: { startsWith: run } }, { payload: { path: ["run"], equals: run } }] },
    });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  it("enqueue without dedupeKey always creates a new QUEUED job", async () => {
    const a = await enqueue(T, { run, n: 1 }, { runAt: future() });
    let b: { id: bigint } | undefined;
    try {
      b = await enqueue(T, { run, n: 2 }, { runAt: future() });
      expect(a.id).not.toBe(b.id);
      expect(a.status).toBe("QUEUED");
    } finally {
      await prisma.job.deleteMany({ where: { id: { in: [a.id, ...(b ? [b.id] : [])] } } });
    }
  });

  it("enqueue with dedupeKey coalesces while QUEUED: payload refreshed, runAt = later of the two, attempts kept", async () => {
    const early = future(0);
    const late = future(60_000);
    const a = await enqueue(T, { run, eventId: "e1" }, { dedupeKey: key("cluster"), runAt: late });
    await prisma.job.update({ where: { id: a.id }, data: { attempts: 2 } });

    const b = await enqueue(T, { run, eventId: "e1", again: true }, { dedupeKey: key("cluster"), runAt: early });
    expect(b.id, "same row reused").toBe(a.id);
    expect(b.payload).toStrictEqual({ run, eventId: "e1", again: true });
    expect(b.runAt.getTime(), "an earlier request does not pull runAt forward (GREATEST)").toBe(late.getTime());
    expect(b.attempts, "attempts are kept while QUEUED").toBe(2);

    const later = future(120_000);
    const c = await enqueue(T, { run, eventId: "e1" }, { dedupeKey: key("cluster"), runAt: later });
    expect(c.id).toBe(a.id);
    expect(c.runAt.getTime(), "a later request pushes runAt back (GREATEST)").toBe(later.getTime());
  });

  it("enqueue with dedupeKey resets a SUCCEEDED job back to QUEUED with the new runAt and attempts 0", async () => {
    const a = await enqueue(T, { run, photoId: "p1" }, { dedupeKey: key("process"), runAt: future() });
    const farFuture = future(10 * HOUR);
    await prisma.job.update({
      where: { id: a.id },
      data: { status: "SUCCEEDED", attempts: 3, lastError: "old", runAt: farFuture, lockedBy: "w1", lockedAt: new Date(), finishedAt: new Date() },
    });

    const next = future(0);
    const b = await enqueue(T, { run, photoId: "p1", v: 2 }, { dedupeKey: key("process"), runAt: next });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe("QUEUED");
    expect(b.attempts, "attempts reset when the row was not QUEUED").toBe(0);
    expect(b.lastError).toBe(null);
    expect(b.lockedBy).toBe(null);
    expect(b.lockedAt).toBe(null);
    expect(b.finishedAt, "a fresh run must not look finished (the jobs dashboard reads finishedAt)").toBe(null);
    expect(b.runAt.getTime(), "new runAt wins when the row was not QUEUED (no GREATEST)").toBe(next.getTime());
    expect(b.payload).toStrictEqual({ run, photoId: "p1", v: 2 });
  });

  it("enqueue with dedupeKey on a QUEUED retry clears its lastError and finishedAt together", async () => {
    const a = await enqueue(T, { run }, { dedupeKey: key("retry"), runAt: future() });
    await prisma.job.update({ where: { id: a.id }, data: { attempts: 1, lastError: "boom", finishedAt: new Date() } });
    const b = await enqueue(T, { run, v: 2 }, { dedupeKey: key("retry"), runAt: future() });
    expect(b.id).toBe(a.id);
    expect(b.lastError).toBe(null);
    expect(b.finishedAt).toBe(null);
    expect(b.attempts, "attempts are kept while QUEUED").toBe(1);
  });

  it("enqueue with dedupeKey leaves a RUNNING job untouched", async () => {
    const a = await enqueue(T, { run, zipExportId: "z1" }, { dedupeKey: key("zip"), runAt: future() });
    await prisma.job.update({ where: { id: a.id }, data: { status: "RUNNING", lockedBy: "w1", lockedAt: new Date() } });
    const b = await enqueue(T, { run, zipExportId: "z1", changed: true }, { dedupeKey: key("zip"), runAt: future() });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe("RUNNING");
    expect(b.lockedBy).toBe("w1");
    expect(b.payload, "payload not overwritten mid-run").toStrictEqual({ run, zipExportId: "z1" });
  });
});
