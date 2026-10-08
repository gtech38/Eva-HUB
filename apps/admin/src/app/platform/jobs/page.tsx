import { prisma } from "@hub/db";
import { PageHeader, Card, Table, StatusBadge, Stat } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { JobHealth } from "@/components/JobHealth";
import { fmtDateTime } from "@/lib/format";
import { JOB_STATUSES } from "@/lib/jobs";
import { loadJobHealth } from "@/lib/jobQueries";
import { retryJob } from "../actions";
import { cancelJobAction, retryDeadJobs } from "./actions";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const [health, jobs] = await Promise.all([
    loadJobHealth(),
    prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const { byStatus } = health.summary;

  return (
    <>
      <PageHeader title="Jobs" description="Postgres-backed queue consumed by the Python worker (SKIP LOCKED). Health is computed over the whole table; last 50 jobs shown." crumbs={[{ href: "/platform", label: "Platform" }, { label: "Jobs" }]} />
      <JobHealth
        health={health}
        typeActions={(type, dead) => dead > 0 && (
          <ActionButton action={retryDeadJobs} fields={{ type }} confirm={`Re-queue all ${dead} dead ${type} job(s)?`}>Retry dead</ActionButton>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {JOB_STATUSES.map((s) => <Stat key={s} label={s} value={byStatus[s]} />)}
      </div>
      <Card title="Recent" padded={false}>
        <Table head={["#", "Type", "Status", "Attempts", "Run at", "Finished", "Payload", "Error", ""]}>
          {jobs.map((j) => (
            <tr key={String(j.id)}>
              <td className="font-mono text-xs text-neutral-500">{String(j.id)}</td>
              <td className="font-mono text-xs">{j.type}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="tabular-nums">{j.attempts}/{j.maxAttempts}</td>
              <td className="whitespace-nowrap text-xs text-neutral-600">{fmtDateTime(j.runAt)}</td>
              <td className="whitespace-nowrap text-xs text-neutral-600">{j.finishedAt ? fmtDateTime(j.finishedAt) : ""}</td>
              <td><code className="block max-w-[260px] truncate text-[11px] text-neutral-600" title={JSON.stringify(j.payload)}>{JSON.stringify(j.payload)}</code></td>
              <td className="max-w-[260px] text-xs text-red-700">{j.lastError && <span className="line-clamp-2" title={j.lastError}>{j.lastError}</span>}</td>
              <td>
                {(j.status === "FAILED" || j.status === "DEAD") && <ActionButton action={retryJob} fields={{ id: String(j.id) }}>Retry</ActionButton>}
                {j.status === "QUEUED" && <ActionButton action={cancelJobAction} fields={{ id: String(j.id) }} confirm={`Cancel job #${String(j.id)} (${j.type})?`}>Cancel</ActionButton>}
              </td>
            </tr>
          ))}
          {jobs.length === 0 && <tr><td colSpan={9} className="text-neutral-500">No jobs yet.</td></tr>}
        </Table>
      </Card>
    </>
  );
}
