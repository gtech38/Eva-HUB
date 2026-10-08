import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@hub/shared/auth";
import { env, cookieDomain } from "@hub/shared/env";

export function sessionCookieOptions(maxAgeSec: number) {
  const e = env();
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: e.ROOT_DOMAIN !== "localhost",
    domain: cookieDomain(),
    maxAge: maxAgeSec,
  };
}

export function setSessionCookie(res: NextResponse, cookieValue: string, expiresAt: Date) {
  const maxAge = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  res.cookies.set({ ...sessionCookieOptions(maxAge), value: cookieValue });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set({ ...sessionCookieOptions(0), value: "", maxAge: 0 });
  return res;
}
