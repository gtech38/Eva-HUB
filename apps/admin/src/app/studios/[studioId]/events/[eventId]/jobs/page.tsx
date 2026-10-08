import { notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Table, StatusBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { JobHealth } from "@/components/JobHealth";
import { fmtDateTime } from "@/lib/format";
import { loadJobHealth } from "@/lib/jobQueries";
import { cancelEventJob } from "./actions";

export const dynamic = "force-dynamic";

export default async function EventJobsPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  const res = { studioId, eventId };
  if (!can(p, "studio.view", res)) notFound();
  await getEvent(studioId, eventId); // 404 unless the event is in this studio; scopes the payload filter below
  const canCancel = can(p, "studio.manage", res);

  const [health, jobs] = await Promise.all([
    loadJobHealth({ eventId }),
    prisma.job.findMany({ where: { payload: { path: ["eventId"], equals: eventId } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <>
      <p className="mb-3 text-xs text-neutral-500">
        Background jobs for this event (photo processing, face clustering, reminders, zips). Workers are shared across events; the ETA assumes they work on this event only.
      </p>
      <JobHealth health={health} showWorkers={false} />
      <Card title="Recent jobs" padded={false}>
        <Table head={["#", "Type", "Status", "Attempts", "Run at", "Error", ""]}>
          {jobs.map((j) => (
            <tr key={String(j.id)}>
              <td className="font-mono text-xs text-neutral-500">{String(j.id)}</td>
              <td className="font-mono text-xs">{j.type}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="tabular-nums">{j.attempts}/{j.maxAttempts}</td>
              <td className="whitespace-nowrap text-xs text-neutral-600">{fmtDateTime(j.runAt)}</td>
              <td className="max-w-[320px] text-xs text-red-700">{j.lastError && <span className="line-clamp-2" title={j.lastError}>{j.lastError}</span>}</td>
              <td>
                {canCancel && j.status === "QUEUED" && (
                  <ActionButton action={cancelEventJob} fields={{ studioId, eventId, id: String(j.id) }} confirm={`Cancel job #${String(j.id)} (${j.type})?`}>Cancel</ActionButton>
                )}
              </td>
            </tr>
          ))}
          {jobs.length === 0 && <tr><td colSpan={7} className="text-neutral-500">No jobs for this event yet.</td></tr>}
        </Table>
      </Card>
    </>
  );
}
