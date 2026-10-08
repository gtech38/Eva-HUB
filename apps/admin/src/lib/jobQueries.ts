/**
 * Database side of the jobs dashboard (ADM-022). Per page: the database clock, one raw aggregate
 * (buckets, with Postgres computing the per-type percentiles), one percentile query across all types,
 * and a small heartbeat lookup, so it stays fast with 100k Job rows. The math is in `./jobs`.
 *
 * Job and WorkerHeartbeat are platform tables with no tenant column. Event scope is
 * `payload->>'eventId'`; callers must already have resolved the event inside its studio
 * (`getEvent(studioId, eventId)`) before passing `eventId` here.
 */
import { Prisma, prisma } from "@hub/db";
import {
  cancelRefusal, etaSeconds, RECENT_WINDOW_MS, summarizeJobs, workerStatuses,
  type DurationPercentiles, type Heartbeat, type JobBucket, type JobsSummary, type JobStatusName, type WorkerStatus,
} from "./jobs";

export type JobScope = { eventId?: string };

type BucketRow = {
  type: string;
  status: JobStatusName;
  due: boolean;
  retrying: boolean;
  count: bigint;
  oldestRunAt: Date | null;
  finishedRecent: bigint;
  priorFailuresRecent: bigint;
  p50Ms: number | null;
  p95Ms: number | null;
};

/** Job timestamps are timestamp(3) in UTC; bind instants as naive UTC so the session time zone cannot shift them. */
const utc = (d: Date) => Prisma.sql`${d.toISOString().replace("Z", "")}::timestamp`;

const inScope = (scope: JobScope) =>
  scope.eventId ? Prisma.sql`payload->>'eventId' = ${scope.eventId}` : Prisma.sql`TRUE`;

/** finishedAt - lockedAt in ms: how long the winning attempt ran. float8 because EXTRACT yields numeric, which Prisma returns as a Decimal object. */
const DURATION_MS = Prisma.sql`(EXTRACT(EPOCH FROM ("finishedAt" - "lockedAt")) * 1000)::float8`;

/**
 * The database's clock as a UTC instant. Heartbeats (`now()` in the worker) and job timestamps are
 * written by Postgres, so liveness and ages are judged against its clock, not this server's.
 */
export async function dbNow(): Promise<Date> {
  const [row] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT (now() AT TIME ZONE 'UTC') AS now`;
  return row!.now;
}

/**
 * Group jobs by type x status x due x retrying. `now` is the instant `summarizeJobs` will use.
 * "Retrying" means failed and waiting for another attempt; a Requeue (`lastError` "requeued: …") is
 * not a failure and is excluded.
 */
export async function loadJobBuckets(now: Date, scope: JobScope = {}): Promise<JobBucket[]> {
  const nowTs = utc(now);
  const since = utc(new Date(now.getTime() - RECENT_WINDOW_MS));
  const rows = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    SELECT type,
           status::text AS status,
           (status = 'QUEUED'::"JobStatus" AND "runAt" <= ${nowTs}) AS due,
           ("lastError" IS NOT NULL AND "lastError" NOT LIKE 'requeued:%') AS retrying,
           count(*) AS count,
           min("runAt") AS "oldestRunAt",
           count(*) FILTER (WHERE "finishedAt" >= ${since}) AS "finishedRecent",
           COALESCE(sum(GREATEST(attempts - 1, 0))
             FILTER (WHERE status = 'SUCCEEDED'::"JobStatus" AND "finishedAt" >= ${since}), 0) AS "priorFailuresRecent",
           percentile_disc(0.5) WITHIN GROUP (ORDER BY ${DURATION_MS})
             FILTER (WHERE status = 'SUCCEEDED'::"JobStatus" AND "finishedAt" >= ${since} AND "lockedAt" IS NOT NULL) AS "p50Ms",
           percentile_disc(0.95) WITHIN GROUP (ORDER BY ${DURATION_MS})
             FILTER (WHERE status = 'SUCCEEDED'::"JobStatus" AND "finishedAt" >= ${since} AND "lockedAt" IS NOT NULL) AS "p95Ms"
      FROM "Job"
     WHERE ${inScope(scope)}
     GROUP BY 1, 2, 3, 4`);
  return rows.map((r) => ({
    type: r.type,
    status: r.status,
    due: r.due,
    retrying: r.retrying,
    count: Number(r.count),
    oldestRunAt: r.oldestRunAt,
    finishedRecent: Number(r.finishedRecent),
    priorFailuresRecent: Number(r.priorFailuresRecent),
    p50Ms: r.p50Ms,
    p95Ms: r.p95Ms,
  }));
}

/** p50/p95 of recent successes across every type in scope (percentiles of separate groups cannot be merged). */
export async function loadDurations(now: Date, scope: JobScope = {}): Promise<DurationPercentiles> {
  const since = utc(new Date(now.getTime() - RECENT_WINDOW_MS));
  const [row] = await prisma.$queryRaw<Array<{ p50Ms: number | null; p95Ms: number | null }>>(Prisma.sql`
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY ${DURATION_MS}) AS "p50Ms",
           percentile_disc(0.95) WITHIN GROUP (ORDER BY ${DURATION_MS}) AS "p95Ms"
      FROM "Job"
     WHERE status = 'SUCCEEDED'::"JobStatus" AND "finishedAt" >= ${since} AND "lockedAt" IS NOT NULL
       AND ${inScope(scope)}`);
  return { p50Ms: row?.p50Ms ?? null, p95Ms: row?.p95Ms ?? null };
}

/** Worker heartbeats, newest first. Liveness is judged from these alone (see `workerStatuses`). */
export async function loadWorkers(): Promise<Heartbeat[]> {
  return prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 50 });
}

export type JobHealth = { now: Date; summary: JobsSummary; workers: WorkerStatus[]; live: number; eta: number | null };

/**
 * Everything the dashboard block renders. Workers are global: any consumer serves every event.
 * `now` defaults to the database clock; tests pass one to look at the table from another moment.
 */
export async function loadJobHealth(scope: JobScope = {}, now?: Date): Promise<JobHealth> {
  const at = now ?? (await dbNow());
  const [buckets, overall, beats] = await Promise.all([loadJobBuckets(at, scope), loadDurations(at, scope), loadWorkers()]);
  const summary = summarizeJobs(buckets, at, overall);
  const workers = workerStatuses(beats, at);
  const live = workers.filter((w) => w.live).length;
  return { now: at, summary, workers, live, eta: etaSeconds(summary.types, live) };
}

/** Newest jobs first, for the "Recent" tables. */
export async function recentJobs(scope: JobScope = {}, take = 50) {
  return prisma.job.findMany({
    where: scope.eventId ? { payload: { path: ["eventId"], equals: scope.eventId } } : {},
    orderBy: { id: "desc" },
    take,
  });
}

const scopedWhere = (id: bigint, scope: JobScope): Prisma.JobWhereInput =>
  scope.eventId ? { id, payload: { path: ["eventId"], equals: scope.eventId } } : { id };

export type CancelResult = { ok: true; type: string } | { ok: false; error: string };

/**
 * QUEUED -> DEAD with `lastError = 'cancelled …'` (Retry or a dedupe re-enqueue brings it back).
 * The update is conditional on QUEUED, so a job claimed between the read and the write is refused too.
 */
export async function cancelJob(id: bigint, scope: JobScope = {}): Promise<CancelResult> {
  const where = scopedWhere(id, scope);
  const job = await prisma.job.findFirst({ where, select: { status: true, type: true } });
  if (!job) return { ok: false, error: "Job not found" };
  const refusal = cancelRefusal(job.status);
  if (refusal) return { ok: false, error: refusal };
  const { count } = await prisma.job.updateMany({
    where: { ...where, status: "QUEUED" },
    data: { status: "DEAD", lastError: "cancelled from the admin Jobs page", lockedAt: null, lockedBy: null },
  });
  if (count === 0) return { ok: false, error: cancelRefusal("RUNNING")! };
  return { ok: true, type: job.type };
}

/** Re-queue every DEAD job of `type` now, with a fresh attempt budget. Returns how many. */
export async function retryDeadOfType(type: string): Promise<number> {
  const { count } = await prisma.job.updateMany({
    where: { type, status: "DEAD" },
    data: { status: "QUEUED", attempts: 0, lockedAt: null, lockedBy: null, finishedAt: null, runAt: new Date() },
  });
  return count;
}
