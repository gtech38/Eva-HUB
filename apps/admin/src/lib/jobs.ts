/**
 * Job-queue health metrics (ADM-022). Pure: the dashboard runs one raw aggregate that groups the
 * Job table into `JobBucket`s (type x status x due x retrying) and hands them here with the same
 * `now` it bound into the query. Nothing in this file touches the database.
 */

export const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD"] as const;
export type JobStatusName = (typeof JOB_STATUSES)[number];

/** "Recent" for succeeded/failed counts and durations. */
export const RECENT_WINDOW_MS = 60 * 60 * 1000;

/** One row of the dashboard aggregate: the jobs of one type/status, split by due and retrying. */
export type JobBucket = {
  type: string;
  status: JobStatusName;
  /** runAt <= now (only meaningful for QUEUED). */
  due: boolean;
  /** lastError IS NOT NULL. */
  retrying: boolean;
  count: number;
  /** Earliest runAt in the bucket. */
  oldestRunAt: Date | null;
  /** Rows whose finishedAt falls within RECENT_WINDOW_MS. */
  finishedRecent: number;
  /** finishedAt - lockedAt, ms, of SUCCEEDED rows finished within RECENT_WINDOW_MS. */
  durationsMs: number[];
};

export type TypeSummary = {
  type: string;
  /** Due QUEUED rows: the queue depth. */
  queued: number;
  /** QUEUED rows with a future runAt (delayed jobs, backoff). */
  scheduled: number;
  running: number;
  /** QUEUED rows with lastError set: failed at least once, will run again. */
  retrying: number;
  dead: number;
  /** Age of the earliest due QUEUED row, whole seconds; null when nothing is due. */
  oldestDueSec: number | null;
  succeededLastHour: number;
  /** Retrying or DEAD rows whose last failure was within the window. */
  failedLastHour: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type JobsSummary = {
  types: TypeSummary[];
  total: Omit<TypeSummary, "type">;
  byStatus: Record<JobStatusName, number>;
};

/** Nearest-rank percentile; null for no samples. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

type Acc = { s: Omit<TypeSummary, "type" | "oldestDueSec" | "p50Ms" | "p95Ms">; oldestDue: number | null; durations: number[] };

const emptyAcc = (): Acc => ({
  s: { queued: 0, scheduled: 0, running: 0, retrying: 0, dead: 0, succeededLastHour: 0, failedLastHour: 0 },
  oldestDue: null,
  durations: [],
});

function add(acc: Acc, b: JobBucket): void {
  const s = acc.s;
  if (b.status === "QUEUED") {
    if (b.due) s.queued += b.count;
    else s.scheduled += b.count;
    if (b.retrying) {
      s.retrying += b.count;
      s.failedLastHour += b.finishedRecent;
    }
    if (b.due && b.oldestRunAt) {
      const t = b.oldestRunAt.getTime();
      acc.oldestDue = acc.oldestDue === null ? t : Math.min(acc.oldestDue, t);
    }
  } else if (b.status === "RUNNING") {
    s.running += b.count;
  } else if (b.status === "DEAD") {
    s.dead += b.count;
    s.failedLastHour += b.finishedRecent;
  } else if (b.status === "SUCCEEDED") {
    s.succeededLastHour += b.finishedRecent;
    acc.durations.push(...b.durationsMs);
  }
}

function finish(acc: Acc, now: Date): Omit<TypeSummary, "type"> {
  return {
    ...acc.s,
    oldestDueSec: acc.oldestDue === null ? null : Math.max(0, Math.floor((now.getTime() - acc.oldestDue) / 1000)),
    p50Ms: percentile(acc.durations, 50),
    p95Ms: percentile(acc.durations, 95),
  };
}

export function summarizeJobs(rows: readonly JobBucket[], now: Date): JobsSummary {
  const perType = new Map<string, Acc>();
  const total = emptyAcc();
  const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatusName, number>;
  for (const b of rows) {
    if (!perType.has(b.type)) perType.set(b.type, emptyAcc());
    add(perType.get(b.type)!, b);
    add(total, b);
    byStatus[b.status] += b.count;
  }
  const types = [...perType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, acc]) => ({ type, ...finish(acc, now) }));
  return { types, total: finish(total, now), byStatus };
}
