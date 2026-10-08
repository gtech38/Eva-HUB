import Link from "next/link";
import { requireAdmin, visibleStudios } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { PageHeader, Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StudiosIndex() {
  const p = await requireAdmin();
  const studios = await visibleStudios(p);
  return (
    <Shell principal={p} studios={studios} sections={[]}>
      <PageHeader title="Your studios" description="Pick a studio to manage." />
      <Card padded={false}>
        {studios.length === 0 ? <div className="p-4"><Empty>No studio access.</Empty></div> : (
          <ul className="divide-y divide-neutral-100">
            {studios.map((s) => (
              <li key={s.id}><Link href={`/studios/${s.id}`} className="flex items-center justify-between px-4 py-3 no-underline hover:bg-neutral-50"><span className="font-medium">{s.name}</span><span className="text-xs text-neutral-500">{s.slug}</span></Link></li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
