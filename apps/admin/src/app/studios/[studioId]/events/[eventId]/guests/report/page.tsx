import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { loadRsvpReport, reportAccess } from "@/lib/guests";
import { SubEventCard } from "./SubEventCard";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  // Vendors get "totals": the loader never selects names and the cards render counts only.
  const access = reportAccess(p, { studioId, eventId });
  if (!access) notFound();
  const base = `/studios/${studioId}/events/${eventId}/guests`;
  const report = await loadRsvpReport(eventId, access);
  const households = await prisma.household.count({ where: { eventId } });
  const pendingHouseholds = await prisma.household.count({ where: { eventId, guests: { some: { deletedAt: null, rsvps: { some: { status: "PENDING" } } } } } });

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-neutral-500">{households} households · {pendingHouseholds} with at least one pending response. Counts include children and plus-one slots.</p>
        <div className="flex gap-2">
          {access === "names" && <a href={`${base}/report/export`} className="btn-secondary">Export all (CSV)</a>}
          <Link href={base} className="btn-ghost">Back to guests</Link>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {report.subEvents.map((s) => <SubEventCard key={s.id} sub={s} access={access} exportBase={`${base}/report/export`} />)}
        {report.subEvents.length === 0 && <p className="text-xs text-neutral-500">No sub-events.</p>}
      </div>
    </>
  );
}
