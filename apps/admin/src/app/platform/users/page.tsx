import Link from "next/link";
import { prisma } from "@hub/db";
import { PageHeader, Card, Table, Badge } from "@/components/ui";
import { lt, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { contactPoints: { some: { value: { contains: q, mode: "insensitive" } } } }] } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      contactPoints: true,
      studioMembers: { include: { studio: { select: { name: true } } } },
      eventMembers: { include: { event: { select: { id: true, title: true, studioId: true } } } },
      guests: { where: { deletedAt: null }, include: { event: { select: { id: true, title: true, studioId: true } } } },
    },
  });

  return (
    <>
      <PageHeader title="Users" description="Global accounts. One person has one account across every event and studio." crumbs={[{ href: "/platform", label: "Platform" }, { label: "Users" }]} />
      <form className="mb-3 flex gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Search name, email or phone" />
        <button className="btn-secondary">Search</button>
        {q && <Link href="/platform/users" className="btn-ghost">Clear</Link>}
      </form>
      <Card padded={false}>
        <Table head={["User", "Contacts", "Status", "Studio roles", "Events", "Created", ""]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td><div className="font-medium">{u.displayName ?? <span className="text-neutral-400">unnamed</span>}</div><div className="font-mono text-[11px] text-neutral-400">{u.id}</div></td>
              <td className="text-xs">{u.contactPoints.map((c) => <div key={c.id} className="flex items-center gap-1"><span>{c.value}</span>{c.verifiedAt ? <Badge tone="green">verified</Badge> : <Badge>unverified</Badge>}{c.smsOptOut && <Badge tone="amber">STOP</Badge>}</div>)}</td>
              <td><div className="flex flex-wrap gap-1"><Badge tone={u.status === "CLAIMED" ? "green" : u.status === "DISABLED" ? "red" : "neutral"}>{u.status}</Badge>{u.isPlatformAdmin && <Badge tone="purple">platform admin</Badge>}</div></td>
              <td className="text-xs">{u.studioMembers.map((m) => <div key={m.id}>{m.studio.name}: {m.role}</div>)}</td>
              <td className="text-xs">
                {u.eventMembers.map((m) => <div key={m.id}><Link href={`/studios/${m.event.studioId}/events/${m.event.id}`} className="hover:underline">{lt(m.event.title)}</Link> <span className="text-neutral-500">({m.role})</span></div>)}
                {u.guests.map((g) => <div key={g.id}><Link href={`/studios/${g.event.studioId}/events/${g.event.id}/guests`} className="hover:underline">{lt(g.event.title)}</Link> <span className="text-neutral-500">(guest)</span></div>)}
              </td>
              <td className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(u.createdAt)}</td>
              <td><button className="btn-secondary btn-sm" disabled title="Merging duplicate accounts requires verifying a code on both channels. Out of scope for this build (Phase 2).">Merge into…</button></td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={7} className="text-neutral-500">No users match.</td></tr>}
        </Table>
      </Card>
    </>
  );
}
