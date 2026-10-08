/**
 * Job-queue health metrics (ADM-022). Pure: the dashboard runs one raw aggregate that groups the
 * Job table into `JobBucket`s (type x status x due x retrying), with Postgres computing the duration
 * percentiles (`percentile_disc`, nearest rank) so no per-job durations travel to Node, and hands
 * them here with the same `now` it bound into the query. Nothing in this file touches the database.
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
  /**
   * Failed attempts that preceded a success: sum(attempts - 1) over SUCCEEDED rows finished within the
   * window. mark_succeeded clears lastError, so without this a job that failed four times and then
   * succeeded would count as zero failures.
   */
  priorFailuresRecent: number;
  /** p50/p95 of finishedAt - lockedAt (ms) over SUCCEEDED rows finished within the window; null otherwise. */
  p50Ms: number | null;
  p95Ms: number | null;
};

export type DurationPercentiles = { p50Ms: number | null; p95Ms: number | null };

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
  /** Failed attempts in the window: retrying/DEAD rows whose last failure was recent, plus the attempts that failed before a recent success. */
  failedLastHour: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type JobsSummary = {
  types: TypeSummary[];
  total: Omit<TypeSummary, "type">;
  byStatus: Record<JobStatusName, number>;
};

type Acc = {
  s: Omit<TypeSummary, "type" | "oldestDueSec" | "p50Ms" | "p95Ms">;
  oldestDue: number | null;
  /** Percentiles of the SUCCEEDED bucket with the most recent finishes (normally the only one). */
  pct: (DurationPercentiles & { n: number }) | null;
};

const emptyAcc = (): Acc => ({
  s: { queued: 0, scheduled: 0, running: 0, retrying: 0, dead: 0, succeededLastHour: 0, failedLastHour: 0 },
  oldestDue: null,
  pct: null,
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
    s.failedLastHour += b.priorFailuresRecent;
    if (acc.pct === null || b.finishedRecent > acc.pct.n) acc.pct = { n: b.finishedRecent, p50Ms: b.p50Ms, p95Ms: b.p95Ms };
  }
}

function finish(acc: Acc, now: Date, pct: DurationPercentiles | null = acc.pct): Omit<TypeSummary, "type"> {
  return {
    ...acc.s,
    oldestDueSec: acc.oldestDue === null ? null : Math.max(0, Math.floor((now.getTime() - acc.oldestDue) / 1000)),
    p50Ms: pct?.p50Ms ?? null,
    p95Ms: pct?.p95Ms ?? null,
  };
}

/**
 * `overall` is the p50/p95 across every type in scope: percentiles of several groups cannot be merged,
 * so the loader asks Postgres for them separately (`loadDurations`).
 */
export function summarizeJobs(rows: readonly JobBucket[], now: Date, overall: DurationPercentiles = { p50Ms: null, p95Ms: null }): JobsSummary {
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
  return { types, total: finish(total, now, overall), byStatus };
}

/**
 * What studio staff may see of `Job.lastError`: the first line only (no traceback, no stack paths) with
 * the `(worker host:pid)` suffix of a released stale lock removed, capped at 160 characters.
 * The full text, including worker identities, stays on /platform/jobs.
 */
export function publicError(lastError: string | null): string | null {
  const first = lastError?.split("\n").map((l) => l.trim()).find((l) => l !== "");
  if (!first) return null;
  const line = first.replace(/\s*\(worker [^)]*\)\s*$/, "");
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

// ── workers ───────────────────────────────────────────────────────────

/** A worker is live when its heartbeat (written every 10 s by a dedicated thread in the consumer, 3x margin) is younger than this. */
export const LIVE_WINDOW_MS = 30_000;

export type Heartbeat = { workerId: string; lastSeenAt: Date; version: string | null; hostname: string | null };
export type WorkerStatus = Heartbeat & { live: boolean };

/**
 * Liveness is the heartbeat alone. The consumer beats from its own thread and connection, so a worker
 * inside a long handler (a big BUILD_ZIP) keeps beating, and silence means the process is gone. Do not
 * add a "holds a RUNNING lock" override: a worker that crashed mid-job leaves its lock for up to an hour
 * and would hide the "No live workers" banner.
 */
export function workerStatuses(beats: readonly Heartbeat[], now: Date): WorkerStatus[] {
  return beats
    .map((b) => ({ ...b, live: now.getTime() - b.lastSeenAt.getTime() < LIVE_WINDOW_MS }))
    .sort((a, b) => Number(b.live) - Number(a.live) || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

/** "How long until done": sum of queued x p50 per type, spread over live workers. Whole seconds, or null when unknown. */
export function etaSeconds(types: ReadonlyArray<Pick<TypeSummary, "queued" | "p50Ms">>, liveWorkers: number): number | null {
  let ms = 0;
  for (const t of types) {
    if (t.queued === 0) continue;
    if (t.p50Ms === null) return null;
    ms += t.queued * t.p50Ms;
  }
  if (ms === 0) return 0;
  if (liveWorkers <= 0) return null;
  return Math.ceil(ms / liveWorkers / 1000);
}

// ── display ───────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 45s, 2m 05s, 1h 03m; "—" for unknown. */
export function fmtAge(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`;
}

/** 850 ms, 2.1 s; "—" for unknown. */
export function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Percentage of recent outcomes that were failures; null when nothing finished. */
export function failureRate(s: Pick<TypeSummary, "succeededLastHour" | "failedLastHour">): number | null {
  const n = s.succeededLastHour + s.failedLastHour;
  return n === 0 ? null : Math.round((s.failedLastHour / n) * 100);
}

// ── actions ───────────────────────────────────────────────────────────

/** Why a job may not be cancelled, or null when it may. A RUNNING handler cannot be interrupted safely. */
export function cancelRefusal(status: JobStatusName): string | null {
  if (status === "QUEUED") return null;
  if (status === "RUNNING") return "Job is running; a running job cannot be cancelled.";
  return `Job is ${status}; only queued jobs can be cancelled.`;
}

/** The alerting slice of the dashboard, for the health endpoint (INF-014). */
export function queueHealth(s: JobsSummary, liveWorkers: number) {
  return {
    queue: { depth: s.total.queued, oldestDueSec: s.total.oldestDueSec, retrying: s.total.retrying, dead: s.total.dead },
    workers: { live: liveWorkers },
  };
}
