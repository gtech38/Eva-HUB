import { prisma } from "@hub/db";
import { eventEnd, inviteExpiry } from "@hub/shared/invites";

/** One event, scoped to its studio, with the sub-event dates `inviteExpiry()` needs. Null when not found. */
export function eventWithDates(studioId: string, eventId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, studioId },
    include: { subEvents: { select: { startsAt: true, endsAt: true } } },
  });
}

/**
 * After a settings/schedule change, push the event's *live* invitation tokens (not revoked, not yet
 * expired, guest not removed) out to the event's current expiry (end + 90 d). Only ever extends:
 * tokens already valid past that date keep their expiry, and dead links are never revived. Returns
 * null when the event is not found in this studio or has no dates (its tokens use the issue-time
 * fallback, which a date change must not keep pushing).
 */
export async function extendInviteTokens(studioId: string, eventId: string, now: Date = new Date()): Promise<{ count: number; expiresAt: Date } | null> {
  const event = await eventWithDates(studioId, eventId);
  if (!event || !eventEnd(event)) return null;
  const expiresAt = inviteExpiry(event, now);
  const { count } = await prisma.inviteToken.updateMany({
    where: { revokedAt: null, expiresAt: { gt: now, lt: expiresAt }, guest: { eventId, studioId, deletedAt: null } },
    data: { expiresAt },
  });
  return { count, expiresAt };
}
