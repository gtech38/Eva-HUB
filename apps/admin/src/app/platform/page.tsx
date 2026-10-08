import Link from "next/link";
import { prisma } from "@hub/db";
import { PageHeader, Card, Table } from "@/components/ui";
import { fmtBytes, fmtDate } from "@/lib/format";
import { CreateStudioForm } from "./CreateStudioForm";

export const dynamic = "force-dynamic";

export default async function PlatformHome() {
  const studios = await prisma.studio.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { events: true, members: true } } } });
  const bytes = await prisma.photo.groupBy({ by: ["studioId"], _sum: { originalBytes: true } });
  const bytesBy = new Map(bytes.map((b) => [b.studioId, b._sum.originalBytes ?? BigInt(0)]));
  const [jobCounts, failed] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.job.count({ where: { status: { in: ["FAILED", "DEAD"] } } }),
  ]);
  const queued = jobCounts.find((j) => j.status === "QUEUED")?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Platform" description="All studios on this installation." actions={<Link href="/platform/jobs" className="btn-secondary">Jobs: {queued} queued{failed ? `, ${failed} failed` : ""}</Link>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Studios" padded={false}>
          <Table head={["Studio", "Slug", "Events", "Users", "Storage", "Retention", "Created"]}>
            {studios.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/studios/${s.id}`} className="font-medium hover:underline">{s.name}</Link></td>
                <td className="font-mono text-xs">{s.slug}</td>
                <td className="tabular-nums">{s._count.events}</td>
                <td className="tabular-nums">{s._count.members}</td>
                <td className="tabular-nums">{fmtBytes(bytesBy.get(s.id))}</td>
                <td className="tabular-nums">{s.faceIndexRetentionDays}d</td>
                <td className="text-neutral-500">{fmtDate(s.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Create studio">
          <CreateStudioForm />
        </Card>
      </div>
    </>
  );
}
