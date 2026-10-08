import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decodeCookie, destroySession } from "@hub/shared/auth";
import { getSite, siteOrigin } from "@/lib/site";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const site = await getSite();
  const id = decodeCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (id) await destroySession(id);
  const origin = site ? siteOrigin(site) : req.nextUrl.origin;
  return clearSessionCookie(NextResponse.redirect(`${origin}/`, { status: 303 }));
}
