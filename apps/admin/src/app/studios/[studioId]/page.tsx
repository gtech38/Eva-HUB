import Link from "next/link";
import { prisma } from "@hub/db";
import { eventOrigin } from "@hub/shared";
import { getStudio } from "@/lib/data";
import { PageHeader, Card, Table, StatusBadge, Empty } from "@/components/ui";
import { lt, fmtDate, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StudioOverview({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const studio = await getStudio(studioId);
  const events = await prisma.event.findMany({
    where: { studioId },
    orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { guests: { where: { deletedAt: null } }, photos: true, households: true } } },
  });
  const rsvps = await prisma.rsvp.groupBy({ by: ["status"], _count: { _all: true }, where: { guest: { studioId, deletedAt: null } } });
  const rsvpByEvent = await prisma.$queryRaw<Array<{ eventId: string; total: bigint; attending: bigint }>>`
    SELECT g."eventId", COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE r.status = 'ATTENDING')::bigint AS attending
    FROM "Rsvp" r JOIN "Guest" g ON g.id = r."guestId"
    WHERE g."studioId" = ${studioId} AND g."deletedAt" IS NULL
    GROUP BY g."eventId"`;
  const r = (id: string) => rsvpByEvent.find((x) => x.eventId === id);
  void rsvps;

  return (
    <>
      <PageHeader title={studio.name} description={`Studio slug: ${studio.slug}`} actions={<Link href={`/studios/${studioId}/events/new`} className="btn-primary">New event</Link>} />
      <Card title="Events" padded={false}>
        {events.length === 0 ? <div className="p-4"><Empty>No events yet. <Link href={`/studios/${studioId}/events/new`} className="underline">Create one</Link>.</Empty></div> : (
          <Table head={["Event", "Status", "Theme", "Date", "Households", "Guests", "RSVP attending", "Photos", "Site"]}>
            {events.map((e) => {
              const x = r(e.id);
              return (
                <tr key={e.id}>
                  <td><Link href={`/studios/${studioId}/events/${e.id}`} className="font-medium hover:underline">{lt(e.title) || e.slug}</Link><div className="font-mono text-[11px] text-neutral-400">{e.slug}</div></td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="text-xs">{e.theme}</td>
                  <td className="whitespace-nowrap text-xs">{fmtDate(e.startsOn)}</td>
                  <td className="tabular-nums">{e._count.households}</td>
                  <td className="tabular-nums">{e._count.guests}</td>
                  <td className="tabular-nums">{x ? `${pct(Number(x.attending), Number(x.total))} (${Number(x.attending)}/${Number(x.total)})` : "—"}</td>
                  <td className="tabular-nums">{e._count.photos}</td>
                  <td><a href={eventOrigin(e.slug)} target="_blank" rel="noreferrer" className="text-xs text-neutral-500 hover:underline">{eventOrigin(e.slug).replace(/^https?:\/\//, "")}</a></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
