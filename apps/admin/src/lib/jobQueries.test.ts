/**
 * Postgres-backed tests for the jobs dashboard queries and job actions (ADM-022). Skipped with a
 * message when Postgres is unreachable.
 *
 * Isolation from a live worker: rows use a per-run `TEST_ADM022_*` type and are never due QUEUED in
 * real time (scheduled an hour ahead, RUNNING, or finished), so no consumer can claim them. Every
 * row carries a per-run eventId in its payload; afterAll() deletes by type.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { cancelJob, loadJobBuckets, loadJobHealth, loadWorkers, retryDeadOfType } from "./jobQueries";

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
    await prisma.workerHeartbeat.deleteMany({ where: { workerId: WORKER } });
  }
  await prisma.$disconnect();
});

const make = (data: Partial<Parameters<typeof prisma.job.create>[0]["data"]> & { eventId?: string }) => {
  const { eventId = EVENT, ...rest } = data;
  return prisma.job.create({ data: { type: T, payload: { eventId }, runAt: new Date(Date.now() + HOUR), ...rest } });
};

describe.skipIf(!dbUp)(suite, () => {
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

  it("retries every DEAD job of one type and nothing else", async () => {
    const type = `${T}_RETRY`;
    const dead = await Promise.all([1, 2].map(() => make({ type, status: "DEAD", attempts: 5, lastError: "x", runAt: new Date(Date.now() - HOUR) })));
    const done = await make({ type, status: "SUCCEEDED" });
    expect(await retryDeadOfType(type)).toBe(2);
    const rows = await prisma.job.findMany({ where: { type }, orderBy: { id: "asc" } });
    expect(rows.filter((r) => dead.some((d) => d.id === r.id)).map((r) => [r.status, r.attempts])).toEqual([["QUEUED", 0], ["QUEUED", 0]]);
    expect(rows.find((r) => r.id === done.id)!.status).toBe("SUCCEEDED");
    // park them again so no consumer can pick them up before afterAll
    await prisma.job.updateMany({ where: { type }, data: { runAt: new Date(Date.now() + HOUR) } });
  });

  it("aggregates one event's jobs into buckets the summary understands", async () => {
    const type = `${T}_AGG`;
    const now = new Date();
    await make({ type, lastError: "boom", finishedAt: new Date(now.getTime() - 60_000) }); // scheduled retry
    await make({ type, status: "SUCCEEDED", lockedAt: new Date(now.getTime() - 2500), finishedAt: new Date(now.getTime() - 500) });
    await make({ type, status: "SUCCEEDED", lockedAt: new Date(now.getTime() - 3 * HOUR), finishedAt: new Date(now.getTime() - 2 * HOUR) });
    await make({ type, status: "RUNNING", eventId: OTHER_EVENT });

    const buckets = (await loadJobBuckets(now, { eventId: EVENT })).filter((b) => b.type === type);
    const queued = buckets.find((b) => b.status === "QUEUED")!;
    expect(queued).toMatchObject({ due: false, retrying: true, count: 1, finishedRecent: 1 });
    const ok = buckets.find((b) => b.status === "SUCCEEDED")!;
    expect(ok).toMatchObject({ count: 2, finishedRecent: 1, durationsMs: [2000] });
    expect(buckets.some((b) => b.status === "RUNNING")).toBe(false); // other event

    // seen from two hours later, the scheduled row is due and its oldest runAt is reported
    const later = await loadJobBuckets(new Date(now.getTime() + 2 * HOUR), { eventId: EVENT });
    const due = later.find((b) => b.type === type && b.status === "QUEUED")!;
    expect(due.due).toBe(true);
    expect(due.oldestRunAt).toBeInstanceOf(Date);

    const all = await loadJobBuckets(now);
    expect(all.some((b) => b.type === type && b.status === "RUNNING")).toBe(true);
  });

  it("loadJobHealth composes the event's summary, live workers and ETA", async () => {
    const type = `${T}_HEALTH`;
    const eventId = `${EVENT}-health`;
    await make({ type, eventId, status: "SUCCEEDED", lockedAt: new Date(Date.now() - 4000), finishedAt: new Date(Date.now() - 1000) });
    await make({ type, eventId, status: "RUNNING", lockedBy: `${WORKER}-health`, lockedAt: new Date() });
    const h = await loadJobHealth({ eventId });
    expect(h.summary.types.map((t) => t.type)).toEqual([type]);
    expect(h.summary.total).toMatchObject({ running: 1, succeededLastHour: 1, p50Ms: 3000 });
    expect(h.eta).toBe(0); // nothing due
    expect(h.live).toBe(h.workers.filter((w) => w.live).length);
  });

  it("loads heartbeats and the lock holders of RUNNING jobs", async () => {
    await prisma.workerHeartbeat.create({ data: { workerId: WORKER, version: "t", hostname: "h" } });
    const { beats, busyIds } = await loadWorkers();
    expect(beats.find((b) => b.workerId === WORKER)).toMatchObject({ version: "t", hostname: "h" });
    expect(busyIds).toContain(WORKER); // the RUNNING job from the first test
  });
});
