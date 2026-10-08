import Link from "next/link";
import { prisma } from "@hub/db";
import { getStudio } from "@/lib/data";
import { PageHeader, Card, Table, Badge } from "@/components/ui";
import { lt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ params, searchParams }: { params: Promise<{ studioId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { studioId } = await params;
  const { q = "" } = await searchParams;
  const studio = await getStudio(studioId);
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [{ guests: { some: { studioId, deletedAt: null } } }, { eventMembers: { some: { event: { studioId } } } }],
      ...(q ? { AND: { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { contactPoints: { some: { value: { contains: q, mode: "insensitive" } } } }, { guests: { some: { studioId, OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } }] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      contactPoints: true,
      guests: { where: { studioId, deletedAt: null }, include: { event: { select: { id: true, title: true, slug: true } } } },
      eventMembers: { where: { event: { studioId } }, include: { event: { select: { id: true, title: true, slug: true } } } },
    },
  });

  return (
    <>
      <PageHeader title="Contacts" description="Everyone with a guest or member relationship to one of this studio's events. Use this list to add hosts, planners or recurring vendors to new events." crumbs={[{ href: `/studios/${studioId}`, label: studio.name }, { label: "Contacts" }]} />
      <form className="mb-3 flex gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Search name or contact" />
        <button className="btn-secondary">Search</button>
        {q && <Link href={`/studios/${studioId}/contacts`} className="btn-ghost">Clear</Link>}
      </form>
      <Card padded={false}>
        <Table head={["Name", "Contacts", "Status", "Events"]}>
          {users.map((u) => {
            const name = u.displayName || [u.guests[0]?.firstName, u.guests[0]?.lastName].filter(Boolean).join(" ") || "—";
            return (
              <tr key={u.id}>
                <td className="font-medium">{name}</td>
                <td className="text-xs">{u.contactPoints.map((c) => <div key={c.id}>{c.value} {c.verifiedAt ? <Badge tone="green">verified</Badge> : <Badge>unverified</Badge>}</div>)}</td>
                <td><Badge tone={u.status === "CLAIMED" ? "green" : "neutral"}>{u.status}</Badge></td>
                <td className="text-xs">
                  {u.eventMembers.map((m) => <div key={m.id}><Link href={`/studios/${studioId}/events/${m.event.id}/members`} className="hover:underline">{lt(m.event.title)}</Link> <Badge tone="blue">{m.role}</Badge></div>)}
                  {u.guests.map((g) => <div key={g.id}><Link href={`/studios/${studioId}/events/${g.event.id}/guests`} className="hover:underline">{lt(g.event.title)}</Link> <Badge>guest</Badge></div>)}
                </td>
              </tr>
            );
          })}
          {users.length === 0 && <tr><td colSpan={4} className="text-neutral-500">No contacts match.</td></tr>}
        </Table>
      </Card>
    </>
  );
}
