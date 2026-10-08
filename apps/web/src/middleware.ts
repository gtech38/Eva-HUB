/**
 * Hostname → tenant routing. Edge-safe: no Prisma here. The slug is taken from the
 * first label of the Host header; `sites/[slug]/layout.tsx` resolves it against the
 * Domain / Event tables in the Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@hub/shared/i18n";
import { HUB_HOST_HEADER, hostOf } from "@/lib/hubHost";

export const LANG_COOKIE = "hub_lang";

// Edge runtime: read directly rather than through env(), with env()'s rule that a blank value means unset.
const ROOT_DOMAIN = (process.env.ROOT_DOMAIN?.trim() || "localhost").toLowerCase();

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const host = hostOf(req.headers.get("host"));
  // Trusted host for handlers: always overwritten here, so a client cannot supply it.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set(HUB_HOST_HEADER, host);

  // Note: every matched request is rewritten below, so the internal `/sites/*` and
  // `/root` segments are never reachable by their literal path.
  // ?lang=te → cookie, then drop the param so URLs stay clean/shareable.
  const lang = url.searchParams.get("lang");
  if (lang !== null) {
    const clean = url.clone();
    clean.searchParams.delete("lang");
    const res = NextResponse.redirect(clean);
    if (isLocale(lang)) res.cookies.set(LANG_COOKIE, lang, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    return res;
  }

  const isRoot = host === ROOT_DOMAIN || host === `app.${ROOT_DOMAIN}` || host === "" || host === "127.0.0.1" || host === "[::1]";
  if (isRoot) {
    const rewritten = url.clone();
    rewritten.pathname = `/root${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(rewritten, { request: { headers: reqHeaders } });
  }

  const slug = host.split(".")[0];
  const rewritten = url.clone();
  rewritten.pathname = `/sites/${slug}${url.pathname === "/" ? "" : url.pathname}`;
  // Forward slug + original path as *request* headers so server components can read them.
  reqHeaders.set("x-hub-slug", slug);
  reqHeaders.set("x-hub-path", url.pathname);
  return NextResponse.rewrite(rewritten, { request: { headers: reqHeaders } });
}

export const config = {
  // Skip Next internals, API routes (they read Host themselves), and static files --
  // except /og.png, which is per site (sites/[slug]/og.png). Literal /sites/* and /root/*
  // paths always run middleware, so they are rewritten (404) and never reach a route
  // without a trusted x-hub-host.
  matcher: [
    "/((?!_next/|api/|robots\\.txt|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map|txt|woff2?)$).*)",
    "/og.png",
    "/sites/:path*",
    "/root/:path*",
  ],
};
