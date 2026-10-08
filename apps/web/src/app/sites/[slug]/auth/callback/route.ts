import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { hashToken, resolveUserForVerifiedContact, linkGuestsForContact, createSession } from "@hub/shared/auth";
import { getSite, siteOrigin } from "@/lib/site";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Magic-link landing: verify the one-time token, mint a session, send them home. */
export async function GET(req: NextRequest) {
  const site = await getSite();
  if (!site) return new NextResponse("Not found", { status: 404 });
  const origin = siteOrigin(site);
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) return NextResponse.redirect(`${origin}/?error=link`);

  const row = await prisma.loginToken.findUnique({ where: { tokenHash: hashToken(token) } });
  const now = new Date();
  if (!row || row.purpose !== "MAGIC_LINK" || row.usedAt || row.expiresAt < now || (row.eventId && row.eventId !== site.event.id)) {
    return NextResponse.redirect(`${origin}/?error=link`);
  }

  // Burn the token first so a double-click can't mint two sessions.
  const burned = await prisma.loginToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (burned.count === 0) return NextResponse.redirect(`${origin}/?error=link`);

  const user = await resolveUserForVerifiedContact(row.channel, row.sentTo);
  await linkGuestsForContact(user.id, row.channel, row.sentTo);
  const { session, cookie } = await createSession(user.id, row.channel === "EMAIL" ? "EMAIL_LINK" : "SMS_OTP");

  await prisma.auditLog.create({
    data: { studioId: site.event.studioId, eventId: site.event.id, actorUserId: user.id, action: "auth.magic_link", target: user.id, data: { channel: row.channel } },
  });

  const dest = row.redirectTo && row.redirectTo.startsWith("/") ? row.redirectTo : "/";
  return setSessionCookie(NextResponse.redirect(`${origin}${dest}`), cookie, session.expiresAt);
}
