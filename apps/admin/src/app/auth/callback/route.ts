import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { SESSION_COOKIE, createSession, env, hashToken } from "@hub/shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const origin = env().ADMIN_ORIGIN;
  if (!token) return NextResponse.redirect(`${origin}/login?expired=1`);

  const row = await prisma.loginToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.purpose !== "MAGIC_LINK" || row.usedAt || row.expiresAt < new Date() || !row.userId) {
    return NextResponse.redirect(`${origin}/login?expired=1`);
  }

  await prisma.loginToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  // Clicking the link proves control of the inbox.
  await prisma.contactPoint.updateMany({ where: { kind: "EMAIL", value: row.sentTo, userId: row.userId, verifiedAt: null }, data: { verifiedAt: new Date() } });

  const { cookie } = await createSession(row.userId, "EMAIL_LINK");
  const res = NextResponse.redirect(`${origin}${row.redirectTo ?? "/"}`);
  res.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: origin.startsWith("https://"),
    maxAge: env().SESSION_TTL_DAYS * 86400,
  });
  return res;
}
