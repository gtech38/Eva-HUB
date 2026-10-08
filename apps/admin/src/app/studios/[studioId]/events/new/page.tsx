import { getStudio, THEMES } from "@/lib/data";
import { requireAdmin, isStale } from "@/lib/auth";
import { can } from "@hub/shared";
import { redirect, notFound } from "next/navigation";
import { PageHeader, Card } from "@/components/ui";
import { NewEventForm } from "./NewEventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const p = await requireAdmin(studioId);
  if (!can(p, "event.create", { studioId })) {
    if (isStale(p, "event.create", { studioId })) redirect("/login?reauth=1");
    notFound();
  }
  const studio = await getStudio(studioId);
  return (
    <>
      <PageHeader title="New event" description="Creates the event, its hostname, default pages and a 'Highlights' album." crumbs={[{ href: `/studios/${studioId}`, label: studio.name }, { label: "New event" }]} />
      <Card className="max-w-2xl">
        <NewEventForm studioId={studioId} themes={THEMES} rootDomain={process.env.ROOT_DOMAIN ?? "localhost"} />
      </Card>
    </>
  );
}
