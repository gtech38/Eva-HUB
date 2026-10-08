import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { loadRsvpReport } from "@/lib/guests";
import { SubEventCard } from "./SubEventCard";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  // The loader decides what this principal may see via can(): vendors get meal counts only (no
  // names, no response counts, no household figures), and nothing at all means 404.
  const report = await loadRsvpReport(p, { studioId, eventId });
  if (!report) notFound();
  const base = `/studios/${studioId}/events/${eventId}/guests`;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {report.households
            ? `${report.households.total} households · ${report.households.withPending} with at least one pending response. Counts include children and plus-one slots.`
            : "Meal counts for attending guests."}
        </p>
        <div className="flex gap-2">
          {report.access === "names" && <a href={`${base}/report/export`} className="btn-secondary">Export all (CSV)</a>}
          <Link href={base} className="btn-ghost">Back to guests</Link>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {report.subEvents.map((s) => <SubEventCard key={s.id} sub={s} access={report.access} exportBase={`${base}/report/export`} />)}
        {report.subEvents.length === 0 && <p className="text-xs text-neutral-500">No sub-events.</p>}
      </div>
    </>
  );
}
