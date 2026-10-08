/**
 * Whether a personal invitation link may open a session. Pure (no Prisma, no Next).
 *
 * Deliberately a boolean: callers must answer every dead link (unknown, other event, removed guest,
 * revoked, expired) the same way, so there is nothing here to tell them apart.
 */
type InviteRow = { revokedAt: Date | null; expiresAt: Date; guest: { eventId: string; deletedAt: Date | null } };

export function inviteUsable(invite: InviteRow | null, eventId: string, now: Date): boolean {
  return !!invite && invite.guest.eventId === eventId && !invite.guest.deletedAt && !invite.revokedAt && invite.expiresAt > now;
}
