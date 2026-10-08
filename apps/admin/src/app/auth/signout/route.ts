import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decodeCookie, destroySession, env } from "@hub/shared";

export const dynamic = "force-dynamic";

async function signout(req: NextRequest) {
  const id = decodeCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (id) await destroySession(id);
  const res = NextResponse.redirect(`${env().ADMIN_ORIGIN}/login?signedout=1`, { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

export const GET = signout;
export const POST = signout;
