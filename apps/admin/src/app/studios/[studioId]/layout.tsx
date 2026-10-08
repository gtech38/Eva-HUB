import { requireAdmin, visibleStudios } from "@/lib/auth";
import { getStudio, studioEvents } from "@/lib/data";
import { Shell } from "@/components/Shell";
import { lt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const p = await requireAdmin(studioId);
  const [studio, studios, events] = await Promise.all([getStudio(studioId), visibleStudios(p), studioEvents(studioId)]);
  const base = `/studios/${studio.id}`;
  return (
    <Shell
      principal={p}
      studios={studios}
      activeStudioId={studio.id}
      sections={[
        { title: "Studio", items: [
          { href: base, label: "Overview" },
          { href: `${base}/settings`, label: "Settings" },
          { href: `${base}/staff`, label: "Staff" },
          { href: `${base}/contacts`, label: "Contacts" },
          { href: `${base}/pricing`, label: "Price sheets" },
        ] },
        { title: "Events", items: [
          ...events.map((e) => ({ href: `${base}/events/${e.id}`, label: lt(e.title) || e.slug })),
          { href: `${base}/events/new`, label: "+ New event" },
        ] },
      ]}
    >
      {children}
    </Shell>
  );
}
