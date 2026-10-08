import Link from "next/link";
import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { redirect, notFound } from "next/navigation";
import { getEvent } from "@/lib/data";
import { requireAdmin, isStale } from "@/lib/auth";
import { Card } from "@/components/ui";
import { lt } from "@/lib/format";
import { ImportWizard } from "./ImportWizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  if (!can(p, "guests.manage", { studioId, eventId })) { if (isStale(p, "guests.manage", { studioId, eventId })) redirect("/login?reauth=1"); notFound(); }
  const subs = await prisma.subEvent.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { name: true } });
  const base = `/studios/${studioId}/events/${eventId}/guests`;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card title="Import guests from CSV">
        <ImportWizard studioId={studioId} eventId={eventId} guestsHref={base} />
      </Card>
      <Card title="Format">
        <p className="mb-2 text-xs text-neutral-600">Columns (header row required): <code className="text-[11px]">household, first_name, last_name, email, phone, is_child, plus_ones, sub_events</code></p>
        <ul className="space-y-1 text-xs text-neutral-600">
          <li><b>household</b> groups rows; it's created on first use (case-insensitive match).</li>
          <li><b>email / phone</b> are deduped against existing guests and within the file.</li>
          <li><b>is_child</b>: yes/true/1.</li>
          <li><b>plus_ones</b>: number of unnamed slots to add for that row's household.</li>
          <li><b>sub_events</b>: <code>;</code>-separated names. Blank = invited to all. Known names: {subs.map((s) => lt(s.name)).join(", ") || "none yet"}.</li>
        </ul>
        <a href={`${base}/import/template`} className="btn-secondary mt-3" download>Download template CSV</a>
        <p className="help mt-3">Google Contacts import is a Phase 2 item.</p>
        <Link href={base} className="btn-ghost mt-3">Back to guests</Link>
      </Card>
    </div>
  );
}
