/**
 * Invitation-link rules for the guest site. Pure (no Prisma, no Next) so the `/i/[token]` route
 * and the client-side SignIn form can both use it.
 */
import { ui, type Locale } from "@hub/shared/i18n";

/** "expired" covers revoked tokens too: either way the guest needs a fresh link. */
export type InviteCheck = "ok" | "expired" | "invalid";

type InviteRow = { revokedAt: Date | null; expiresAt: Date; guest: { eventId: string; deletedAt: Date | null } };

export function checkInvite(invite: InviteRow | null, eventId: string, now: Date): InviteCheck {
  if (!invite || invite.guest.eventId !== eventId || invite.guest.deletedAt) return "invalid";
  if (invite.revokedAt || invite.expiresAt < now) return "expired";
  return "ok";
}

const FLAG = "invite";
const EXPIRED = "expired";

/** Where a dead invitation link lands: the sign-in form with an expiry explanation. */
export const INVITE_EXPIRED_PATH = `/?${FLAG}=${EXPIRED}`;

/** Heading and help shown above the sign-in form after a dead invitation link, else null. */
export function inviteNotice(params: Pick<URLSearchParams, "get"> | null, locale: Locale): { heading: string; help: string } | null {
  if (params?.get(FLAG) !== EXPIRED) return null;
  return { heading: ui("inviteExpired", locale), help: ui("inviteExpiredHelp", locale) };
}
