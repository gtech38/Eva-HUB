import { prisma } from "@hub/db";
import { eventEnd, inviteExpiry } from "@hub/shared/invites";

/** Load the dates `inviteExpiry()` needs for one event, scoped to its studio. */
export function eventDates(studioId: string, eventId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, studioId },
    select: { startsOn: true, subEvents: { select: { startsAt: true, endsAt: true } } },
  });
}

/**
 * After a settings/schedule change, push every non-revoked invitation token of the event out to
 * the event's current expiry (end + 90 d). Only ever extends: tokens already valid past that
 * date keep their expiry. Returns null when the event is not found in this studio or has no
 * dates (its tokens use the issue-time fallback, which a date change must not keep pushing).
 */
export async function extendInviteTokens(studioId: string, eventId: string): Promise<{ count: number; expiresAt: Date } | null> {
  const dates = await eventDates(studioId, eventId);
  if (!dates || !eventEnd(dates)) return null;
  const expiresAt = inviteExpiry(dates);
  const { count } = await prisma.inviteToken.updateMany({
    where: { revokedAt: null, expiresAt: { lt: expiresAt }, guest: { eventId, studioId } },
    data: { expiresAt },
  });
  return { count, expiresAt };
}
