import { prisma } from "@hub/db";
import { lt } from "@/lib/format";

/** Make a guest's SubEventInvite + Rsvp rows match `wanted`. Answered RSVPs are never removed. */
export async function syncInvites(eventId: string, guestId: string, wanted: Set<string>) {
  const subs = await prisma.subEvent.findMany({ where: { eventId }, select: { id: true, name: true } });
  const invites = await prisma.subEventInvite.findMany({ where: { guestId } });
  const rsvps = await prisma.rsvp.findMany({ where: { guestId } });
  const blocked: string[] = [];
  for (const s of subs) {
    const has = invites.some((i) => i.subEventId === s.id);
    if (wanted.has(s.id) && !has) {
      await prisma.subEventInvite.create({ data: { guestId, subEventId: s.id } });
      await prisma.rsvp.upsert({ where: { guestId_subEventId: { guestId, subEventId: s.id } }, create: { guestId, subEventId: s.id, status: "PENDING" }, update: {} });
    } else if (!wanted.has(s.id) && has) {
      const r = rsvps.find((x) => x.subEventId === s.id);
      if (r && r.status !== "PENDING") { blocked.push(lt(s.name)); continue; }
      await prisma.rsvp.deleteMany({ where: { guestId, subEventId: s.id } });
      await prisma.subEventInvite.delete({ where: { guestId_subEventId: { guestId, subEventId: s.id } } });
    }
  }
  return { blocked };
}
