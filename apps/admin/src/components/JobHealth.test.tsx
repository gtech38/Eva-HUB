import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { JobHealth } from "./JobHealth";
import { etaSeconds, summarizeJobs, workerStatuses, type JobBucket } from "@/lib/jobs";
import type { JobHealth as Health } from "@/lib/jobQueries";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

const bucket = (over: Partial<JobBucket> & Pick<JobBucket, "type" | "status">): JobBucket => ({
  due: false, retrying: false, count: 0, oldestRunAt: null, finishedRecent: 0, priorFailuresRecent: 0, p50Ms: null, p95Ms: null, ...over,
});

/** The same composition `loadJobHealth` does, from fixed inputs. */
function health(beatAgesSec: number[]): Health {
  const summary = summarizeJobs(
    [
      bucket({ type: "PROCESS_PHOTO", status: "QUEUED", due: true, count: 10, oldestRunAt: ago(236) }),
      bucket({ type: "PROCESS_PHOTO", status: "SUCCEEDED", count: 5, finishedRecent: 5, p50Ms: 2000, p95Ms: 3000 }),
    ],
    NOW,
    { p50Ms: 2000, p95Ms: 3000 },
  );
  const workers = workerStatuses(beatAgesSec.map((s, i) => ({ workerId: `host-${i}:42`, lastSeenAt: ago(s), version: "0.1.0", hostname: `host-${i}` })), NOW);
  const live = workers.filter((w) => w.live).length;
  return { now: NOW, summary, workers, live, eta: etaSeconds(summary.types, live) };
}

describe("JobHealth (acceptance criterion: 'No live workers' when stopped, the ETA when running)", () => {
  it("shows the No live workers banner and no ETA when the worker is stopped", () => {
    const html = renderToString(<JobHealth health={health([600])} />); // last beat 10 minutes ago
    expect(html).toContain("No live workers");
    expect(html).toContain('data-testid="no-live-workers"');
    expect(html).toMatch(/data-testid="jobs-eta">—</);
    expect(html).toContain("no workers"); // why the ETA is blank
  });

  it("shows no banner and the ETA when a worker is running", () => {
    const html = renderToString(<JobHealth health={health([3])} />);
    expect(html).not.toContain("No live workers");
    expect(html).toMatch(/data-testid="jobs-eta">20s</); // 10 queued x 2 s p50 / 1 live worker
    expect(html).toContain("3m 56s"); // oldest due
  });

  it("divides the ETA across live workers", () => {
    expect(renderToString(<JobHealth health={health([3, 8])} />)).toMatch(/data-testid="jobs-eta">10s</);
  });

  it("warns even before any worker has ever reported", () => {
    const html = renderToString(<JobHealth health={health([])} />);
    expect(html).toContain("No live workers");
    expect(html).toContain("No worker has ever reported");
  });

  it("studio-scoped views hide worker ids and hostnames and the platform instructions", () => {
    const html = renderToString(<JobHealth health={health([3])} showWorkers={false} />);
    expect(html).not.toContain("host-0");
    expect(html).not.toContain("make consume");
    const stopped = renderToString(<JobHealth health={health([600])} showWorkers={false} />);
    expect(stopped).toContain("No live workers");
    expect(stopped).not.toContain("make consume");
    expect(stopped).not.toContain("host-0");
  });

  it("renders per-type actions only when asked", () => {
    const withActions = renderToString(<JobHealth health={health([3])} typeActions={(type) => <b>{`ACT-${type}`}</b>} />);
    expect(withActions).toContain("ACT-PROCESS_PHOTO");
    expect(renderToString(<JobHealth health={health([3])} />)).not.toContain("ACT-");
  });
});
