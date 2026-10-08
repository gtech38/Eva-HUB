import type { ReactNode } from "react";
import { Badge, Card, Stat, Table } from "@/components/ui";
import { failureRate, fmtAge, fmtMs, LIVE_WINDOW_MS } from "@/lib/jobs";
import type { JobHealth as Health } from "@/lib/jobQueries";

/** Queue health block (ADM-022): live workers, depth, oldest due age, outcomes, durations, ETA, per-type table. */
export function JobHealth({ health, typeActions, showWorkers = true }: {
  health: Health;
  typeActions?: (type: string, dead: number) => ReactNode;
  /** Worker ids/hostnames are platform infrastructure; studio-scoped views show only the live count. */
  showWorkers?: boolean;
}) {
  const { summary, workers, live, eta, now } = health;
  const t = summary.total;
  const rate = failureRate(t);
  return (
    <div className="mb-4 space-y-4">
      {live === 0 ? (
        <div role="alert" data-testid="no-live-workers" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>No live workers.</strong> No job consumer has reported in the last {LIVE_WINDOW_MS / 1000} s, so queued jobs are not being processed.
          {showWorkers
            ? <> Start one with <code>make consume</code> (or <code>make dev</code>) in <code>workers/media</code>.</>
            : " Contact the platform administrator if this persists."}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Live workers" value={live} sub={workers.length > live ? `${workers.length - live} silent` : undefined} />
        <Stat label="Queued (due)" value={t.queued} sub={t.scheduled ? `${t.scheduled} scheduled` : undefined} />
        <Stat label="Oldest due" value={fmtAge(t.oldestDueSec)} />
        <Stat label="ETA" value={<span data-testid="jobs-eta">{eta === null ? "—" : fmtAge(eta)}</span>} sub={eta === null && t.queued > 0 ? (live === 0 ? "no workers" : "no recent timings") : "queued × p50 / workers"} />
        <Stat label="Running" value={t.running} />
        <Stat label="Retrying" value={t.retrying} sub={`${t.dead} dead`} />
        <Stat label="Last hour" value={`${t.succeededLastHour} ok`} sub={`${t.failedLastHour} failed attempts${rate === null ? "" : ` (${rate}%)`}`} />
        <Stat label="Duration p50 / p95" value={fmtMs(t.p50Ms)} sub={`p95 ${fmtMs(t.p95Ms)}`} />
      </div>
      <div className={`grid gap-4 ${showWorkers ? "xl:grid-cols-[1fr_360px]" : ""}`}>
        <Card title="Queue by type" padded={false}>
          <Table head={["Type", "Queued", "Sched.", "Running", "Retrying", "Dead", "Oldest due", "OK/h", "Failed attempts/h", "p50", "p95", ...(typeActions ? [""] : [])]}>
            {summary.types.map((s) => (
              <tr key={s.type}>
                <td className="font-mono text-xs">{s.type}</td>
                <td className="tabular-nums">{s.queued}</td>
                <td className="tabular-nums text-neutral-600">{s.scheduled}</td>
                <td className="tabular-nums text-neutral-600">{s.running}</td>
                <td className="tabular-nums text-amber-700">{s.retrying || ""}</td>
                <td className="tabular-nums text-red-700">{s.dead || ""}</td>
                <td className="tabular-nums text-neutral-600">{fmtAge(s.oldestDueSec)}</td>
                <td className="tabular-nums text-neutral-600">{s.succeededLastHour}</td>
                <td className="tabular-nums text-neutral-600">{s.failedLastHour}</td>
                <td className="tabular-nums text-neutral-600">{fmtMs(s.p50Ms)}</td>
                <td className="tabular-nums text-neutral-600">{fmtMs(s.p95Ms)}</td>
                {typeActions && <td>{typeActions(s.type, s.dead)}</td>}
              </tr>
            ))}
            {summary.types.length === 0 && <tr><td colSpan={12} className="text-neutral-500">No jobs yet.</td></tr>}
          </Table>
        </Card>
        {showWorkers && <Card title="Workers" padded={false}>
          <Table head={["Worker", "Version", "Last seen", ""]}>
            {workers.map((w) => (
              <tr key={w.workerId}>
                <td className="font-mono text-xs" title={w.hostname ?? undefined}>{w.workerId}</td>
                <td className="font-mono text-xs text-neutral-600">{w.version ?? "—"}</td>
                <td className="whitespace-nowrap text-xs text-neutral-600">{fmtAge((now.getTime() - w.lastSeenAt.getTime()) / 1000)} ago</td>
                <td>{w.live ? <Badge tone="green">live</Badge> : <Badge tone="neutral">silent</Badge>}</td>
              </tr>
            ))}
            {workers.length === 0 && <tr><td colSpan={4} className="text-neutral-500">No worker has ever reported.</td></tr>}
          </Table>
        </Card>}
      </div>
    </div>
  );
}
