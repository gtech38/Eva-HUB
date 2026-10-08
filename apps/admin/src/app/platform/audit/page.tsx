import { prisma } from "@hub/db";
import { PageHeader, Card, Table } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, contactPoints: { where: { isPrimary: true }, select: { value: true }, take: 1 } } }) : [];
  const actorName = (id: string | null) => { if (!id) return "system"; const a = actors.find((x) => x.id === id); return a?.displayName || a?.contactPoints[0]?.value || id.slice(0, 8); };
  const studios = await prisma.studio.findMany({ select: { id: true, name: true } });
  const studioName = (id: string | null) => studios.find((s) => s.id === id)?.name ?? (id ? id.slice(0, 8) : "—");

  return (
    <>
      <PageHeader title="Audit log" description="Last 200 entries. Permission, visibility, consent, export and deletion events." crumbs={[{ href: "/platform", label: "Platform" }, { label: "Audit log" }]} />
      <Card padded={false}>
        <Table head={["When", "Actor", "Action", "Studio", "Event", "Target", "Data"]}>
          {rows.map((r) => (
            <tr key={String(r.id)}>
              <td className="whitespace-nowrap text-xs text-neutral-600">{fmtDateTime(r.createdAt)}</td>
              <td className="text-xs">{actorName(r.actorUserId)}</td>
              <td className="font-mono text-xs">{r.action}</td>
              <td className="text-xs">{studioName(r.studioId)}</td>
              <td className="font-mono text-[11px] text-neutral-500">{r.eventId ? r.eventId.slice(0, 10) : "—"}</td>
              <td className="font-mono text-[11px] text-neutral-500">{r.target ?? "—"}</td>
              <td><code className="block max-w-[360px] truncate text-[11px] text-neutral-600" title={JSON.stringify(r.data)}>{r.data ? JSON.stringify(r.data) : ""}</code></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="text-neutral-500">Nothing logged yet.</td></tr>}
        </Table>
      </Card>
    </>
  );
}
