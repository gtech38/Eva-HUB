import Link from "next/link";
import { prisma } from "@hub/db";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Table } from "@/components/ui";
import { lt, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  const base = `/studios/${studioId}/events/${eventId}/guests`;
  const subs = await prisma.subEvent.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }], include: { mealOptions: { orderBy: { sortOrder: "asc" } } } });
  const rsvps = await prisma.rsvp.findMany({ where: { subEvent: { eventId }, guest: { deletedAt: null } }, include: { guest: { select: { isChild: true, isPlusOne: true } } } });
  const households = await prisma.household.count({ where: { eventId } });
  const pendingHouseholds = await prisma.household.count({ where: { eventId, guests: { some: { deletedAt: null, rsvps: { some: { status: "PENDING" } } } } } });

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-neutral-500">{households} households · {pendingHouseholds} with at least one pending response. Counts include children and plus-one slots.</p>
        <div className="flex gap-2"><a href={`${base}/report/export`} className="btn-secondary">Export CSV</a><Link href={base} className="btn-ghost">Back to guests</Link></div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {subs.map((s) => {
          const rs = rsvps.filter((r) => r.subEventId === s.id);
          const n = (st: string) => rs.filter((r) => r.status === st).length;
          const attending = rs.filter((r) => r.status === "ATTENDING");
          const kids = attending.filter((r) => r.guest.isChild).length;
          return (
            <Card key={s.id} title={lt(s.name)}>
              <div className="mb-3 grid grid-cols-4 gap-2 text-center">
                <div className="rounded bg-neutral-50 p-2"><div className="text-lg font-semibold tabular-nums">{rs.length}</div><div className="text-[11px] text-neutral-500">invited</div></div>
                <div className="rounded bg-green-50 p-2"><div className="text-lg font-semibold tabular-nums text-green-800">{n("ATTENDING")}</div><div className="text-[11px] text-neutral-500">attending ({pct(n("ATTENDING"), rs.length)})</div></div>
                <div className="rounded bg-red-50 p-2"><div className="text-lg font-semibold tabular-nums text-red-800">{n("DECLINED")}</div><div className="text-[11px] text-neutral-500">declined</div></div>
                <div className="rounded bg-neutral-50 p-2"><div className="text-lg font-semibold tabular-nums">{n("PENDING")}</div><div className="text-[11px] text-neutral-500">pending</div></div>
              </div>
              <div className="text-xs text-neutral-600">Attending: {attending.length - kids} adults · {kids} children</div>
              {s.servesMeal && (
                <Table head={["Meal", "Count"]} className="mt-3">
                  {s.mealOptions.map((m) => <tr key={m.id}><td>{lt(m.label)}{m.isKidsMeal && <span className="ml-1 text-neutral-400">(kids)</span>}</td><td className="tabular-nums">{attending.filter((r) => r.mealOptionId === m.id).length}</td></tr>)}
                  <tr><td className="text-neutral-500">No choice yet</td><td className="tabular-nums text-neutral-500">{attending.filter((r) => !r.mealOptionId).length}</td></tr>
                </Table>
              )}
            </Card>
          );
        })}
        {subs.length === 0 && <p className="text-xs text-neutral-500">No sub-events.</p>}
      </div>
    </>
  );
}
