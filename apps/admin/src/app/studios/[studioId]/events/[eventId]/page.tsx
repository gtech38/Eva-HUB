import Link from "next/link";
import { prisma } from "@hub/db";
import { eventOrigin } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { Card, Stat, Table, StatusBadge } from "@/components/ui";
import { fmtDate, fmtDateTime, lt, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EventOverview({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const event = await getEvent(studioId, eventId);
  const base = `/studios/${studioId}/events/${eventId}`;
  const [households, guests, rsvp, photos, ready, albums, members, subEvents, msgs, entitlement, jobs] = await Promise.all([
    prisma.household.count({ where: { eventId } }),
    prisma.guest.count({ where: { eventId, deletedAt: null } }),
    prisma.rsvp.groupBy({ by: ["status"], _count: { _all: true }, where: { guest: { eventId, deletedAt: null } } }),
    prisma.photo.count({ where: { eventId } }),
    prisma.photo.count({ where: { eventId, status: "READY" } }),
    prisma.album.count({ where: { eventId } }),
    prisma.eventMember.findMany({ where: { eventId }, include: { user: { select: { displayName: true, contactPoints: { select: { value: true }, take: 1 } } } } }),
    prisma.subEvent.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }], select: { id: true, name: true, startsAt: true, venueName: true } }),
    prisma.message.groupBy({ by: ["purpose", "status"], _count: { _all: true }, where: { eventId } }),
    prisma.entitlement.findFirst({ where: { eventId, scope: "GALLERY_FULLRES", userId: null, revokedAt: null } }),
    prisma.job.findMany({ where: { status: { in: ["FAILED", "DEAD"] }, payload: { path: ["eventId"], equals: eventId } }, take: 5, orderBy: { createdAt: "desc" } }),
  ]);
  const rc = (s: string) => rsvp.find((r) => r.status === s)?._count._all ?? 0;
  const total = rsvp.reduce((a, r) => a + r._count._all, 0);
  const invitesSent = msgs.filter((m) => m.purpose === "INVITATION").reduce((a, m) => a + m._count._all, 0);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Households" value={households} />
        <Stat label="Guests" value={guests} />
        <Stat label="Attending" value={rc("ATTENDING")} sub={`${pct(rc("ATTENDING"), total)} of ${total} invites`} />
        <Stat label="Declined / pending" value={`${rc("DECLINED")} / ${rc("PENDING")}`} />
        <Stat label="Photos" value={photos} sub={`${ready} ready · ${albums} albums`} />
        <Stat label="Invitations sent" value={invitesSent} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Quick actions">
          <div className="flex flex-col gap-1.5">
            <Link href={`${base}/guests/import`} className="btn-secondary justify-center">Import guests (CSV)</Link>
            <Link href={`${base}/invites`} className="btn-secondary justify-center">Send invitations</Link>
            <Link href={`${base}/gallery`} className="btn-secondary justify-center">Upload photos</Link>
            <Link href={`${base}/guests/report`} className="btn-secondary justify-center">RSVP report</Link>
            <Link href={`${base}/settings`} className="btn-secondary justify-center">Settings</Link>
          </div>
        </Card>
        <Card title="Details">
          <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
            <dt className="text-neutral-500">Site</dt><dd><a href={eventOrigin(event.slug)} target="_blank" rel="noreferrer" className="hover:underline">{eventOrigin(event.slug)}</a></dd>
            <dt className="text-neutral-500">Status</dt><dd><StatusBadge status={event.status} /></dd>
            <dt className="text-neutral-500">Theme</dt><dd>{event.theme}</dd>
            <dt className="text-neutral-500">Date</dt><dd>{fmtDate(event.startsOn)} · {event.timezone}</dd>
            <dt className="text-neutral-500">Locales</dt><dd>{event.enabledLocales.join(", ")} (default {event.defaultLocale})</dd>
            <dt className="text-neutral-500">Face search</dt><dd>{event.faceSearchEnabled ? "on" : "off"} · purge {event.faceIndexPurgeAt ? fmtDate(event.faceIndexPurgeAt) : "not scheduled"}</dd>
            <dt className="text-neutral-500">Gallery</dt><dd>{entitlement ? <span className="text-green-700">unlocked (full-res for all guests)</span> : "locked (watermarked)"}</dd>
            <dt className="text-neutral-500">Created</dt><dd>{fmtDateTime(event.createdAt)}</dd>
          </dl>
        </Card>
        <Card title="Members" actions={<Link href={`${base}/members`} className="text-xs hover:underline">Manage</Link>} padded={false}>
          <Table head={["Role", "Who"]}>
            {members.map((m) => <tr key={m.id}><td className="text-xs">{m.role}</td><td className="text-xs">{m.user.displayName ?? m.user.contactPoints[0]?.value ?? m.userId}</td></tr>)}
            {members.length === 0 && <tr><td colSpan={2} className="text-neutral-500">No hosts yet.</td></tr>}
          </Table>
        </Card>
        <Card title="Schedule" actions={<Link href={`${base}/schedule`} className="text-xs hover:underline">Edit</Link>} padded={false} className="lg:col-span-2">
          <Table head={["Sub-event", "Starts", "Venue"]}>
            {subEvents.map((s) => <tr key={s.id}><td className="font-medium">{lt(s.name)}</td><td className="text-xs">{fmtDateTime(s.startsAt)}</td><td className="text-xs text-neutral-600">{s.venueName ?? "—"}</td></tr>)}
            {subEvents.length === 0 && <tr><td colSpan={3} className="text-neutral-500">No sub-events yet.</td></tr>}
          </Table>
        </Card>
        <Card title="Failed jobs for this event" padded={false}>
          <Table head={["Type", "Error"]}>
            {jobs.map((j) => <tr key={String(j.id)}><td className="font-mono text-xs">{j.type}</td><td className="text-xs text-red-700">{j.lastError ?? "—"}</td></tr>)}
            {jobs.length === 0 && <tr><td colSpan={2} className="text-xs text-neutral-500">None.</td></tr>}
          </Table>
        </Card>
      </div>
    </>
  );
}
