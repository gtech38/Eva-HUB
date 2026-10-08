import { describe, expect, it } from "vitest";
import { cancelRefusal, etaSeconds, failureRate, fmtAge, fmtMs, publicError, queueHealth, summarizeJobs, workerStatuses, type DurationStats, type Heartbeat, type JobBucket, type TypeSummary } from "./jobs";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

/** A bucket with every count at zero; override what the case needs. */
function bucket(over: Partial<JobBucket> & Pick<JobBucket, "type" | "status">): JobBucket {
  return { due: false, retrying: false, count: 0, oldestRunAt: null, finishedRecent: 0, priorFailuresRecent: 0, ...over };
}

describe("summarizeJobs", () => {
  const rows: JobBucket[] = [
    // PROCESS_PHOTO: 3 due (oldest 120 s ago), of which 1 retrying; 2 scheduled; 1 running;
    // 4 succeeded recently, 2 of them only after earlier failed attempts (2 failures in total)
    bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: true, count: 2, oldestRunAt: ago(120) }),
    bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: true, retrying: true, count: 1, oldestRunAt: ago(30), finishedRecent: 1 }),
    bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: false, count: 2, oldestRunAt: new Date(NOW.getTime() + 60_000) }),
    bucket({ type: "PROCESS_PHOTO", status: "RUNNING", count: 1, oldestRunAt: ago(5) }),
    bucket({ type: "PROCESS_PHOTO", status: "SUCCEEDED", count: 10, finishedRecent: 4, priorFailuresRecent: 2 }),
    // INDEX_FACES: 1 retrying but not yet due, 2 dead (1 died within the hour), 1 succeeded recently
    bucket({ type: "INDEX_FACES", status: "QUEUED", due: false, retrying: true, count: 1, oldestRunAt: new Date(NOW.getTime() + 5_000) }),
    bucket({ type: "INDEX_FACES", status: "DEAD", retrying: true, count: 2, finishedRecent: 1 }),
    bucket({ type: "INDEX_FACES", status: "SUCCEEDED", count: 1, finishedRecent: 1 }),
  ];

  // Percentiles come from Postgres (percentile_disc) in a separate query, per type and overall.
  const durations: DurationStats = {
    overall: { p50Ms: 300, p95Ms: 1000 },
    byType: { PROCESS_PHOTO: { p50Ms: 200, p95Ms: 400 }, INDEX_FACES: { p50Ms: 1000, p95Ms: 1000 } },
  };
  const s = summarizeJobs(rows, NOW, durations);
  const photo = s.types.find((t) => t.type === "PROCESS_PHOTO")!;
  const faces = s.types.find((t) => t.type === "INDEX_FACES")!;

  it("counts depth as due QUEUED rows and keeps scheduled rows apart", () => {
    expect(photo.queued).toBe(3);
    expect(photo.scheduled).toBe(2);
    expect(photo.running).toBe(1);
    expect(faces.queued).toBe(0);
    expect(faces.scheduled).toBe(1);
    expect(s.total.queued).toBe(3);
    expect(s.total.scheduled).toBe(3);
  });

  it("reports the oldest due age in seconds from the earliest due runAt, ignoring scheduled rows", () => {
    expect(photo.oldestDueSec).toBe(120);
    expect(faces.oldestDueSec).toBeNull();
    expect(s.total.oldestDueSec).toBe(120);
  });

  it("counts retrying as QUEUED rows with lastError, due or not", () => {
    expect(photo.retrying).toBe(1);
    expect(faces.retrying).toBe(1);
    expect(s.total.retrying).toBe(2);
  });

  it("counts dead rows and recent outcomes (failed = retrying or dead in the window, plus failed attempts before a success)", () => {
    expect(faces.dead).toBe(2);
    expect(photo.succeededLastHour).toBe(4);
    // mark_succeeded clears lastError, so a job that failed twice and then succeeded would otherwise count as zero failures
    expect(photo.failedLastHour).toBe(1 + 2);
    expect(faces.failedLastHour).toBe(1);
    expect(s.total.succeededLastHour).toBe(5);
    expect(s.total.failedLastHour).toBe(4);
    expect(failureRate(s.total)).toBe(44); // 4 failed of 9 attempts
  });

  it("passes the database's p50/p95 through, per type and overall", () => {
    expect(photo.p50Ms).toBe(200);
    expect(photo.p95Ms).toBe(400);
    expect(faces.p50Ms).toBe(1000);
    expect(s.total.p50Ms).toBe(300);
    expect(s.total.p95Ms).toBe(1000);
  });

  it("totals every status for the header tiles and sorts types by name", () => {
    expect(s.byStatus).toEqual({ QUEUED: 6, RUNNING: 1, SUCCEEDED: 11, FAILED: 0, DEAD: 2 });
    expect(s.types.map((t) => t.type)).toEqual(["INDEX_FACES", "PROCESS_PHOTO"]);
  });

  it("leaves percentiles null for a type with no recent successes or when none were supplied", () => {
    const none = summarizeJobs(rows, NOW);
    expect(none.total).toMatchObject({ p50Ms: null, p95Ms: null });
    expect(none.types.every((t) => t.p50Ms === null && t.p95Ms === null)).toBe(true);
    const partial = summarizeJobs(rows, NOW, { overall: { p50Ms: 5, p95Ms: 6 }, byType: { PROCESS_PHOTO: { p50Ms: 1, p95Ms: 2 } } });
    expect(partial.types.find((t) => t.type === "INDEX_FACES")).toMatchObject({ p50Ms: null, p95Ms: null });
  });

  it("is empty but well-formed with no rows", () => {
    const e = summarizeJobs([], NOW);
    expect(e.types).toEqual([]);
    expect(e.total).toMatchObject({ queued: 0, oldestDueSec: null, p50Ms: null, p95Ms: null });
  });
});

describe("workerStatuses", () => {
  const beat = (workerId: string, secondsAgo: number): Heartbeat => ({ workerId, lastSeenAt: ago(secondsAgo), version: "0.1.0", hostname: "h" });

  it("a worker seen within 30 s is live; one silent for 30 s or more is not", () => {
    const ws = workerStatuses([beat("a:1", 29), beat("b:2", 30), beat("c:3", 600)], NOW);
    expect(ws.map((w) => [w.workerId, w.live])).toEqual([["a:1", true], ["b:2", false], ["c:3", false]]);
  });

  it("liveness is the heartbeat alone: a worker that went silent 10 minutes ago is not live (it may have crashed mid-job)", () => {
    // The heartbeat comes from its own thread, so a worker inside a long handler keeps beating; silence
    // means the process is gone, whatever RUNNING locks it left behind.
    const [w] = workerStatuses([beat("zip:9", 600)], NOW);
    expect(w!.live).toBe(false);
    expect(Object.keys(w!)).not.toContain("busy");
  });

  it("lists live workers first, most recently seen first", () => {
    const ws = workerStatuses([beat("old:1", 900), beat("b:2", 10), beat("a:1", 2)], NOW);
    expect(ws.map((w) => w.workerId)).toEqual(["a:1", "b:2", "old:1"]);
  });
});

describe("etaSeconds", () => {
  const t = (type: string, queued: number, p50Ms: number | null) => ({ type, queued, p50Ms }) as TypeSummary;

  it("is queued x p50 summed over types, divided by live workers", () => {
    expect(etaSeconds([t("PROCESS_PHOTO", 100, 2000), t("INDEX_FACES", 50, 400)], 2)).toBe(110);
  });

  it("is null with no live workers, and when a type with work has no recent duration", () => {
    expect(etaSeconds([t("PROCESS_PHOTO", 100, 2000)], 0)).toBeNull();
    expect(etaSeconds([t("PROCESS_PHOTO", 1, null)], 1)).toBeNull();
  });

  it("is zero when nothing is due, even without a duration sample", () => {
    expect(etaSeconds([t("PROCESS_PHOTO", 0, null)], 1)).toBe(0);
  });
});

describe("formatting", () => {
  it("fmtAge renders seconds, minutes and hours compactly", () => {
    expect(fmtAge(null)).toBe("—");
    expect(fmtAge(0)).toBe("0s");
    expect(fmtAge(45)).toBe("45s");
    expect(fmtAge(125)).toBe("2m 05s");
    expect(fmtAge(3780)).toBe("1h 03m");
    expect(fmtAge(2 * 86400 + 3600)).toBe("49h 00m");
  });

  it("fmtMs renders milliseconds below a second and seconds above", () => {
    expect(fmtMs(null)).toBe("—");
    expect(fmtMs(850.4)).toBe("850 ms");
    expect(fmtMs(2140)).toBe("2.1 s");
  });

  it("failureRate is failed / (succeeded + failed) as a percentage, null with no outcomes", () => {
    expect(failureRate({ succeededLastHour: 3, failedLastHour: 1 })).toBe(25);
    expect(failureRate({ succeededLastHour: 0, failedLastHour: 0 })).toBeNull();
  });
});

describe("publicError (what studio staff may see of a job's lastError)", () => {
  it("keeps only the first line: no traceback, no file paths from the stack", () => {
    const err = 'RuntimeError: kaboom\nTraceback (most recent call last):\n  File "/srv/hub_worker/jobs.py", line 3, in run_once\n    boom()';
    expect(publicError(err)).toBe("RuntimeError: kaboom");
  });

  it("strips the worker identity suffix of a released stale lock", () => {
    expect(publicError("stale lock released (worker mac-mini.local:4242)")).toBe("stale lock released");
    expect(publicError("stale lock released (worker ?)")).toBe("stale lock released");
  });

  it("skips leading blank lines and caps the length", () => {
    expect(publicError("\n\n  ValueError: bad\nmore")).toBe("ValueError: bad");
    const long = publicError("x".repeat(500))!;
    expect(long.length).toBe(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("passes null and empty through as null", () => {
    expect(publicError(null)).toBeNull();
    expect(publicError("  \n ")).toBeNull();
  });
});

describe("cancelRefusal", () => {
  it("job.cancel is refused for RUNNING jobs", () => {
    expect(cancelRefusal("RUNNING")).toMatch(/running/i);
  });

  it("refuses finished jobs and allows only QUEUED (due or scheduled)", () => {
    expect(cancelRefusal("QUEUED")).toBeNull();
    for (const s of ["SUCCEEDED", "FAILED", "DEAD"] as const) expect(cancelRefusal(s)).toMatch(/only queued/i);
  });
});

describe("queueHealth", () => {
  it("exposes queue.oldestDueSec and workers.live for alerting", () => {
    const s = summarizeJobs([bucket({ type: "X", status: "QUEUED", due: true, count: 4, oldestRunAt: ago(90) })], NOW);
    expect(queueHealth(s, 0)).toEqual({ queue: { depth: 4, oldestDueSec: 90, retrying: 0, dead: 0 }, workers: { live: 0 } });
  });
});
