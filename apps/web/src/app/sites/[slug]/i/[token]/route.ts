import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { hashToken, resolveUserForVerifiedContact, createSession } from "@hub/shared/auth";
import { getSite, siteOrigin } from "@/lib/site";
import { setSessionCookie } from "@/lib/session";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Personal invitation link. Creates/resolves the user for the address the invite was
 * delivered to, links the Guest row, and opens a guest-scoped INVITE_LINK session.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const site = await getSite();
  if (!site) return new NextResponse("Not found", { status: 404 });
  const origin = siteOrigin(site);
  const { token } = await ctx.params;

  const invite = await prisma.inviteToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { guest: true } });
  const now = new Date();
  if (!invite || invite.revokedAt || invite.expiresAt < now || invite.guest.eventId !== site.event.id || invite.guest.deletedAt) {
    return NextResponse.redirect(`${origin}/?error=invite`);
  }

  await prisma.inviteToken.update({ where: { id: invite.id }, data: { lastUsedAt: now } });

  const guest = invite.guest;
  const user = await resolveUserForVerifiedContact(invite.channel, invite.sentTo, fullName(guest, "") || null);

  if (!guest.userId) {
    // One guest row per (event, user): only link when this user has no other row here.
    const clash = await prisma.guest.findUnique({ where: { eventId_userId: { eventId: guest.eventId, userId: user.id } } });
    if (!clash) await prisma.guest.update({ where: { id: guest.id }, data: { userId: user.id } });
  }

  const { session, cookie } = await createSession(user.id, "INVITE_LINK", site.event.id);
  await prisma.auditLog.create({
    data: { studioId: site.event.studioId, eventId: site.event.id, actorUserId: user.id, action: "auth.invite_link", target: guest.id, data: { channel: invite.channel } },
  });
  return setSessionCookie(NextResponse.redirect(`${origin}/rsvp`), cookie, session.expiresAt);
}
