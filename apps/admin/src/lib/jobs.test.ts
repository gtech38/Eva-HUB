import { describe, expect, it } from "vitest";
import { cancelRefusal, etaSeconds, percentile, queueHealth, summarizeJobs, workerStatuses, type Heartbeat, type JobBucket, type TypeSummary } from "./jobs";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

/** A bucket with every count at zero; override what the case needs. */
function bucket(over: Partial<JobBucket> & Pick<JobBucket, "type" | "status">): JobBucket {
  return { due: false, retrying: false, count: 0, oldestRunAt: null, finishedRecent: 0, durationsMs: [], ...over };
}

describe("percentile (nearest rank)", () => {
  it("returns null for no samples", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("picks the nearest-rank value regardless of input order", () => {
    const xs = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});

describe("summarizeJobs", () => {
  const rows: JobBucket[] = [
    // PROCESS_PHOTO: 3 due (oldest 120 s ago), of which 1 retrying; 2 scheduled; 1 running; 4 succeeded recently
    bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: true, count: 2, oldestRunAt: ago(120) }),
    bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: true, retrying: true, count: 1, oldestRunAt: ago(30), finishedRecent: 1 }),
    bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: false, count: 2, oldestRunAt: new Date(NOW.getTime() + 60_000) }),
    bucket({ type: "PROCESS_PHOTO", status: "RUNNING", count: 1, oldestRunAt: ago(5) }),
    bucket({ type: "PROCESS_PHOTO", status: "SUCCEEDED", count: 10, finishedRecent: 4, durationsMs: [400, 100, 300, 200] }),
    // INDEX_FACES: 1 retrying but not yet due, 2 dead (1 died within the hour), 1 succeeded long ago
    bucket({ type: "INDEX_FACES", status: "QUEUED", due: false, retrying: true, count: 1, oldestRunAt: new Date(NOW.getTime() + 5_000) }),
    bucket({ type: "INDEX_FACES", status: "DEAD", retrying: true, count: 2, finishedRecent: 1 }),
    bucket({ type: "INDEX_FACES", status: "SUCCEEDED", count: 1, finishedRecent: 1, durationsMs: [1000] }),
  ];

  const s = summarizeJobs(rows, NOW);
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

  it("counts dead rows and recent outcomes (failed = retrying or dead, finished within the window)", () => {
    expect(faces.dead).toBe(2);
    expect(photo.succeededLastHour).toBe(4);
    expect(photo.failedLastHour).toBe(1);
    expect(faces.failedLastHour).toBe(1);
    expect(s.total.succeededLastHour).toBe(5);
    expect(s.total.failedLastHour).toBe(2);
  });

  it("computes p50/p95 duration from recent successes, per type and overall", () => {
    expect(photo.p50Ms).toBe(200);
    expect(photo.p95Ms).toBe(400);
    expect(faces.p50Ms).toBe(1000);
    expect(s.total.p50Ms).toBe(300); // [100,200,300,400,1000]
    expect(s.total.p95Ms).toBe(1000);
  });

  it("totals every status for the header tiles and sorts types by name", () => {
    expect(s.byStatus).toEqual({ QUEUED: 6, RUNNING: 1, SUCCEEDED: 11, FAILED: 0, DEAD: 2 });
    expect(s.types.map((t) => t.type)).toEqual(["INDEX_FACES", "PROCESS_PHOTO"]);
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
    const ws = workerStatuses([beat("a:1", 29), beat("b:2", 30), beat("c:3", 600)], [], NOW);
    expect(ws.map((w) => [w.workerId, w.live])).toEqual([["a:1", true], ["b:2", false], ["c:3", false]]);
  });

  it("a silent worker still holding a RUNNING job counts as live and busy (long handlers skip beats)", () => {
    const [w] = workerStatuses([beat("zip:9", 300)], ["zip:9"], NOW);
    expect(w).toMatchObject({ live: true, busy: true });
  });

  it("lists live workers first, most recently seen first", () => {
    const ws = workerStatuses([beat("old:1", 900), beat("b:2", 10), beat("a:1", 2)], [], NOW);
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
