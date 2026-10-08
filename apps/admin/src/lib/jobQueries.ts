/**
 * Database side of the jobs dashboard (ADM-022). Two reads per page (one raw aggregate, one pair of
 * small heartbeat/lock lookups) so it stays fast with 100k Job rows; the math is in `./jobs`.
 *
 * Job and WorkerHeartbeat are platform tables with no tenant column. Event scope is
 * `payload->>'eventId'`; callers must already have resolved the event inside its studio
 * (`getEvent(studioId, eventId)`) before passing `eventId` here.
 */
import { Prisma, prisma } from "@hub/db";
import { cancelRefusal, RECENT_WINDOW_MS, type Heartbeat, type JobBucket, type JobStatusName } from "./jobs";

export type JobScope = { eventId?: string };

type BucketRow = {
  type: string;
  status: JobStatusName;
  due: boolean;
  retrying: boolean;
  count: bigint;
  oldestRunAt: Date | null;
  finishedRecent: bigint;
  durationsMs: number[] | null;
};

/** Job timestamps are timestamp(3) in UTC; bind instants as naive UTC so the session time zone cannot shift them. */
const utc = (d: Date) => Prisma.sql`${d.toISOString().replace("Z", "")}::timestamp`;

const eventFilter = (scope: JobScope) =>
  scope.eventId ? Prisma.sql`WHERE payload->>'eventId' = ${scope.eventId}` : Prisma.empty;

/** Group jobs by type x status x due x retrying. `now` is the instant `summarizeJobs` will use. */
export async function loadJobBuckets(now: Date, scope: JobScope = {}): Promise<JobBucket[]> {
  const nowTs = utc(now);
  const since = utc(new Date(now.getTime() - RECENT_WINDOW_MS));
  const rows = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    SELECT type,
           status::text AS status,
           (status = 'QUEUED'::"JobStatus" AND "runAt" <= ${nowTs}) AS due,
           ("lastError" IS NOT NULL) AS retrying,
           count(*) AS count,
           min("runAt") AS "oldestRunAt",
           count(*) FILTER (WHERE "finishedAt" >= ${since}) AS "finishedRecent",
           array_agg((EXTRACT(EPOCH FROM ("finishedAt" - "lockedAt")) * 1000)::float8)
             FILTER (WHERE status = 'SUCCEEDED'::"JobStatus" AND "finishedAt" >= ${since} AND "lockedAt" IS NOT NULL)
             AS "durationsMs"
      FROM "Job"
      ${eventFilter(scope)}
     GROUP BY 1, 2, 3, 4`);
  return rows.map((r) => ({
    type: r.type,
    status: r.status,
    due: r.due,
    retrying: r.retrying,
    count: Number(r.count),
    oldestRunAt: r.oldestRunAt,
    finishedRecent: Number(r.finishedRecent),
    durationsMs: r.durationsMs ?? [],
  }));
}

/** Recent heartbeats plus the lockedBy of RUNNING jobs (a worker inside a long handler does not beat). */
export async function loadWorkers(): Promise<{ beats: Heartbeat[]; busyIds: string[] }> {
  const [beats, running] = await Promise.all([
    prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 50 }),
    prisma.job.findMany({ where: { status: "RUNNING", lockedBy: { not: null } }, select: { lockedBy: true }, distinct: ["lockedBy"] }),
  ]);
  return { beats, busyIds: running.map((r) => r.lockedBy!) };
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
    data: { status: "QUEUED", attempts: 0, lockedAt: null, lockedBy: null, runAt: new Date() },
  });
  return count;
}
