import { prisma } from "@hub/db";
import { PageHeader, Card, Table, StatusBadge, Stat } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { retryJob } from "../actions";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const [byStatus, byType, jobs] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.job.groupBy({ by: ["type", "status"], _count: { _all: true }, orderBy: { type: "asc" } }),
    prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const types = [...new Set(byType.map((b) => b.type))];
  const statuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD"] as const;

  return (
    <>
      <PageHeader title="Jobs" description="Postgres-backed queue consumed by the Python worker (SKIP LOCKED). Last 50 jobs shown." crumbs={[{ href: "/platform", label: "Platform" }, { label: "Jobs" }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {statuses.map((s) => <Stat key={s} label={s} value={count(s)} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card title="By type" padded={false}>
          <Table head={["Type", ...statuses.map((s) => s.slice(0, 1))]}>
            {types.map((t) => (
              <tr key={t}>
                <td className="font-mono text-xs">{t}</td>
                {statuses.map((s) => <td key={s} className="tabular-nums text-neutral-600">{byType.find((b) => b.type === t && b.status === s)?._count._all ?? 0}</td>)}
              </tr>
            ))}
            {types.length === 0 && <tr><td colSpan={6} className="text-neutral-500">No jobs yet.</td></tr>}
          </Table>
          <p className="px-3 py-2 text-[11px] text-neutral-400">Q R S F D = queued, running, succeeded, failed, dead</p>
        </Card>
        <Card title="Recent" padded={false}>
          <Table head={["#", "Type", "Status", "Attempts", "Run at", "Payload", "Error", ""]}>
            {jobs.map((j) => (
              <tr key={String(j.id)}>
                <td className="font-mono text-xs text-neutral-500">{String(j.id)}</td>
                <td className="font-mono text-xs">{j.type}</td>
                <td><StatusBadge status={j.status} /></td>
                <td className="tabular-nums">{j.attempts}/{j.maxAttempts}</td>
                <td className="whitespace-nowrap text-xs text-neutral-600">{fmtDateTime(j.runAt)}</td>
                <td><code className="block max-w-[260px] truncate text-[11px] text-neutral-600" title={JSON.stringify(j.payload)}>{JSON.stringify(j.payload)}</code></td>
                <td className="max-w-[260px] text-xs text-red-700">{j.lastError && <span className="line-clamp-2" title={j.lastError}>{j.lastError}</span>}</td>
                <td>{(j.status === "FAILED" || j.status === "DEAD") && <ActionButton action={retryJob} fields={{ id: String(j.id) }}>Retry</ActionButton>}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={8} className="text-neutral-500">No jobs yet.</td></tr>}
          </Table>
        </Card>
      </div>
    </>
  );
}
