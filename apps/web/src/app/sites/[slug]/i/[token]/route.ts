import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { hashToken, resolveUserForVerifiedContact, createSession } from "@hub/shared/auth";
import { getSite, siteOrigin } from "@/lib/site";
import { setSessionCookie } from "@/lib/session";
import { fullName } from "@/lib/format";
import { inviteUsable } from "@/lib/inviteLink";
import { INVITE_EXPIRED_PATH } from "@/lib/inviteNotice";
import { clientIp, rateLimits } from "@hub/shared/ratePolicies";

export const dynamic = "force-dynamic";

/**
 * Personal invitation link. Creates/resolves the user for the address the invite was
 * delivered to, links the Guest row, and opens a guest-scoped INVITE_LINK session that ends no
 * later than the token. Every dead link (expired, revoked, unknown, another event's) gets the same
 * answer: the sign-in form with an expiry heading, no cookie, token not stamped.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const site = await getSite();
  if (!site) return new NextResponse("Not found", { status: 404 });
  const origin = siteOrigin(site);
  const { token } = await ctx.params;

  // Token-guessing guard (SHR-003): counted before the lookup, so the answer cannot depend on the token.
  const ip = clientIp(req.headers);
  const limited = await rateLimits.check("inviteIp", ip, { studioId: site.event.studioId, eventId: site.event.id });
  if (!limited.ok) {
    return new NextResponse("Too many requests. Please try again later.", {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSec), "Cache-Control": "private, no-store" },
    });
  }

  const invite = await prisma.inviteToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { guest: true } });
  const now = new Date();
  if (!invite || !inviteUsable(invite, site.event.id, now)) {
    return NextResponse.redirect(`${origin}${INVITE_EXPIRED_PATH}`);
  }

  await prisma.inviteToken.update({ where: { id: invite.id }, data: { lastUsedAt: now } });

  const guest = invite.guest;
  const user = await resolveUserForVerifiedContact(invite.channel, invite.sentTo, fullName(guest, "") || null);

  if (!guest.userId) {
    // One guest row per (event, user): only link when this user has no other row here.
    const clash = await prisma.guest.findUnique({ where: { eventId_userId: { eventId: guest.eventId, userId: user.id } } });
    if (!clash) await prisma.guest.update({ where: { id: guest.id }, data: { userId: user.id } });
  }

  const { session, cookie } = await createSession(user.id, "INVITE_LINK", { guestScopeEventId: site.event.id, inviteExpiresAt: invite.expiresAt, now });
  await prisma.auditLog.create({
    data: { studioId: site.event.studioId, eventId: site.event.id, actorUserId: user.id, action: "auth.invite_link", target: guest.id, data: { channel: invite.channel } },
  });
  return setSessionCookie(NextResponse.redirect(`${origin}/rsvp`), cookie, session.expiresAt);
}
