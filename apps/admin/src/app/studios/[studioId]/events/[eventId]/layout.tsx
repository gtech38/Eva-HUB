import Link from "next/link";
import { eventOrigin } from "@hub/shared";
import { getStudio, getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { StatusBadge } from "@/components/ui";
import { EventTabs } from "./EventTabs";
import { lt, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  await requireAdmin(studioId);
  const [studio, event] = await Promise.all([getStudio(studioId), getEvent(studioId, eventId)]);
  const base = `/studios/${studioId}/events/${eventId}`;
  const site = eventOrigin(event.slug);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <nav className="flex items-center gap-1 text-xs text-neutral-500">
            <Link href={`/studios/${studioId}`} className="text-neutral-500 hover:underline">{studio.name}</Link>
            <span className="text-neutral-300">/</span>
            <span className="text-neutral-700">Events</span>
          </nav>
          <div className="mt-0.5 flex items-center gap-2">
            <h1 className="text-xl">{lt(event.title) || event.slug}</h1>
            <StatusBadge status={event.status} />
            <span className="text-xs text-neutral-500">{event.theme} · {fmtDate(event.startsOn)}</span>
          </div>
        </div>
        <a href={site} target="_blank" rel="noreferrer" className="btn-secondary">Open site ↗</a>
      </div>
      <EventTabs base={base} />
      {children}
    </div>
  );
}
