/**
 * Postgres-backed tests for the jobs dashboard queries (ADM-022). Skipped with a message when
 * Postgres is unreachable.
 *
 * Isolation from a live worker: rows use a per-run `TEST_ADM022_*` type and are never due QUEUED in
 * real time (scheduled an hour ahead, RUNNING, or finished), so no consumer can claim them; tests
 * that need "due" rows look at the table from a later `now` instead. Every row carries a per-run
 * eventId in its payload. Each test creates the rows it asserts on; afterAll() deletes by type.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { cancelJob, dbNow, loadDurations, loadJobBuckets, loadJobHealth, loadWorkers, recentJobs, retryDeadOfType } from "./jobQueries";

const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const T = `TEST_ADM022_${run}`;
const EVENT = `test-event-adm022-${run}`;
const OTHER_EVENT = `${EVENT}-other`;
const HOUR = 3_600_000;
const WORKER = `test-worker-adm022-${run}`;

const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const suite = dbUp ? "job queries against Postgres" : "job queries against Postgres [skipped: Postgres unreachable at DATABASE_URL]";
if (!dbUp) console.log("# apps/admin jobQueries: Postgres unreachable -- skipping");

afterAll(async () => {
  if (dbUp) {
    await prisma.job.deleteMany({ where: { type: { startsWith: T } } });
    await prisma.workerHeartbeat.deleteMany({ where: { workerId: { startsWith: WORKER } } });
  }
  await prisma.$disconnect();
});

const make = (data: Partial<Parameters<typeof prisma.job.create>[0]["data"]> & { eventId?: string }) => {
  const { eventId = EVENT, ...rest } = data;
  return prisma.job.create({ data: { type: T, payload: { eventId }, runAt: new Date(Date.now() + HOUR), ...rest } });
};

describe.skipIf(!dbUp)(suite, () => {
  it("takes `now` from the database clock, read as UTC", async () => {
    const now = await dbNow();
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("job.cancel is refused for RUNNING jobs and leaves the row untouched", async () => {
    const job = await make({ status: "RUNNING", lockedBy: WORKER, lockedAt: new Date(), attempts: 1 });
    const r = await cancelJob(job.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/running/i);
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "RUNNING", lockedBy: WORKER, lastError: null });
  });

  it("cancels a scheduled job: DEAD with a cancelled lastError", async () => {
    const job = await make({});
    const r = await cancelJob(job.id, { eventId: EVENT });
    expect(r).toEqual({ ok: true, type: T });
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("DEAD");
    expect(after.lastError).toMatch(/^cancelled/);
  });

  it("an event-scoped cancel cannot reach another event's job", async () => {
    const job = await make({ eventId: OTHER_EVENT });
    const r = await cancelJob(job.id, { eventId: EVENT });
    expect(r).toEqual({ ok: false, error: "Job not found" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
  });

  it("retries every DEAD job of one type, clears finishedAt, and touches nothing else", async () => {
    const type = `${T}_RETRY`;
    const finishedAt = new Date(Date.now() - 60_000);
    const dead = await Promise.all([1, 2].map(() => make({ type, status: "DEAD", attempts: 5, lastError: "x", finishedAt, runAt: new Date(Date.now() - HOUR) })));
    const done = await make({ type, status: "SUCCEEDED", finishedAt });
    expect(await retryDeadOfType(type)).toBe(2);
    const rows = await prisma.job.findMany({ where: { type }, orderBy: { id: "asc" } });
    expect(rows.filter((r) => dead.some((d) => d.id === r.id)).map((r) => [r.status, r.attempts, r.finishedAt])).toEqual([["QUEUED", 0, null], ["QUEUED", 0, null]]);
    expect(rows.find((r) => r.id === done.id)).toMatchObject({ status: "SUCCEEDED", finishedAt });
    // park them again so no consumer can pick them up before afterAll
    await prisma.job.updateMany({ where: { type }, data: { runAt: new Date(Date.now() + HOUR) } });
  });

  it("aggregates one event's jobs into buckets, with Postgres computing the duration percentiles", async () => {
    const type = `${T}_AGG`;
    const now = new Date();
    const ok = (durationMs: number, attempts: number, finishedAgoMs: number) =>
      make({ type, status: "SUCCEEDED", attempts, lockedAt: new Date(now.getTime() - finishedAgoMs - durationMs), finishedAt: new Date(now.getTime() - finishedAgoMs) });
    await make({ type, lastError: "boom", finishedAt: new Date(now.getTime() - 60_000) }); // scheduled retry
    await make({ type, lastError: "requeued: more photos arrived" }); // a Requeue is not a failure
    await ok(2000, 3, 500); // succeeded on its third attempt: two failures preceded it
    await ok(4000, 1, 1000);
    await ok(9000, 2, 2 * HOUR); // outside the window
    await make({ type, status: "RUNNING", eventId: OTHER_EVENT });

    const buckets = (await loadJobBuckets(now, { eventId: EVENT })).filter((b) => b.type === type);
    const retrying = buckets.find((b) => b.status === "QUEUED" && b.retrying)!;
    expect(retrying).toMatchObject({ due: false, count: 1, finishedRecent: 1 });
    const requeued = buckets.find((b) => b.status === "QUEUED" && !b.retrying)!;
    expect(requeued).toMatchObject({ count: 1, finishedRecent: 0 });
    const succeeded = buckets.find((b) => b.status === "SUCCEEDED")!;
    expect(succeeded).toMatchObject({ count: 3, finishedRecent: 2, priorFailuresRecent: 2, p50Ms: 2000, p95Ms: 4000 });
    expect(buckets.some((b) => b.status === "RUNNING")).toBe(false); // other event

    // seen from two hours later, the scheduled rows are due and their oldest runAt is reported
    const later = await loadJobBuckets(new Date(now.getTime() + 2 * HOUR), { eventId: EVENT });
    const due = later.find((b) => b.type === type && b.status === "QUEUED" && b.retrying)!;
    expect(due.due).toBe(true);
    expect(due.oldestRunAt).toBeInstanceOf(Date);

    const all = await loadJobBuckets(now);
    expect(all.some((b) => b.type === type && b.status === "RUNNING")).toBe(true);
  });

  it("computes overall p50/p95 over recent successes of every type in scope", async () => {
    const eventId = `${EVENT}-durations`;
    const now = new Date();
    const ok = (type: string, durationMs: number) =>
      make({ type, eventId, status: "SUCCEEDED", lockedAt: new Date(now.getTime() - 1000 - durationMs), finishedAt: new Date(now.getTime() - 1000) });
    await Promise.all([ok(`${T}_A`, 100), ok(`${T}_A`, 200), ok(`${T}_B`, 300), ok(`${T}_B`, 400), ok(`${T}_B`, 1000)]);
    expect(await loadDurations(now, { eventId })).toEqual({ p50Ms: 300, p95Ms: 1000 });
    expect(await loadDurations(now, { eventId: `${eventId}-none` })).toEqual({ p50Ms: null, p95Ms: null });
  });

  it("loadJobHealth composes the event's summary, live workers and an ETA from the database clock", async () => {
    const type = `${T}_HEALTH`;
    const eventId = `${EVENT}-health`;
    const now = new Date(Date.now() + 2 * HOUR); // the rows scheduled an hour ahead are due from here
    const seen = (workerId: string, secondsAgo: number) => prisma.workerHeartbeat.create({ data: { workerId, lastSeenAt: new Date(now.getTime() - secondsAgo * 1000), version: "t", hostname: "h" } });
    await Promise.all([
      make({ type, eventId, status: "SUCCEEDED", lockedAt: new Date(now.getTime() - 4000), finishedAt: new Date(now.getTime() - 1000) }), // 3 s
      make({ type, eventId }), make({ type, eventId }), make({ type, eventId }), // 3 due from `now`
      seen(`${WORKER}-live`, 5),
      seen(`${WORKER}-silent`, 600),
    ]);
    const h = await loadJobHealth({ eventId }, now);
    expect(h.summary.types.map((t) => t.type)).toEqual([type]);
    expect(h.summary.total).toMatchObject({ queued: 3, succeededLastHour: 1, p50Ms: 3000 });
    expect(h.workers.find((w) => w.workerId === `${WORKER}-live`)!.live).toBe(true);
    expect(h.workers.find((w) => w.workerId === `${WORKER}-silent`)!.live).toBe(false);
    expect(h.live).toBeGreaterThanOrEqual(1);
    expect(h.eta).toBe(Math.ceil((3 * 3000) / 1000 / h.live));
  });

  it("loadWorkers returns heartbeats only; a RUNNING lock says nothing about liveness", async () => {
    await prisma.workerHeartbeat.create({ data: { workerId: `${WORKER}-hb`, version: "t", hostname: "h" } });
    await make({ status: "RUNNING", lockedBy: `${WORKER}-hb-crashed`, lockedAt: new Date() });
    const beats = await loadWorkers();
    expect(beats.find((b) => b.workerId === `${WORKER}-hb`)).toMatchObject({ version: "t", hostname: "h" });
    expect(beats.some((b) => b.workerId === `${WORKER}-hb-crashed`)).toBe(false);
  });

  it("recentJobs returns the newest first, limited, and only the event's own jobs when scoped", async () => {
    const type = `${T}_RECENT`;
    const eventId = `${EVENT}-recent`;
    const mine = [await make({ type, eventId }), await make({ type, eventId }), await make({ type, eventId })]; // sequential: ids must follow creation order
    await make({ type, eventId: OTHER_EVENT });
    const rows = await recentJobs({ eventId }, 2);
    expect(rows.map((r) => r.id)).toEqual([mine[2]!.id, mine[1]!.id]);
    const unscoped = await recentJobs({}, 50);
    expect(unscoped.some((r) => (r.payload as { eventId?: string }).eventId === OTHER_EVENT)).toBe(true);
  });
});
