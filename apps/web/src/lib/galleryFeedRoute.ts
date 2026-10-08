// tdd-exempt: Next wiring (session -> galleryFeed -> JSON); the rules are tested in galleryFeed.test.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireViewer } from "@/lib/site";
import { faceSearchAllowed } from "@/lib/faceConsent";
import { galleryFeed, type Feed } from "@/lib/galleryFeed";

/** Shared body of the three `GET /api/gallery/*` route handlers. */
export async function handleGalleryFeed(req: NextRequest, feed: Feed) {
  const headers = { "Cache-Control": "private, no-store" };
  const site = await requireViewer();
  if (!site) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401, headers });
  const result = await galleryFeed(
    { event: site.event, viewer: site.viewer, faceSearchAllowed: faceSearchAllowed(process.env.NODE_ENV) },
    feed,
    req.nextUrl.searchParams.get("cursor"),
  );
  return NextResponse.json(result.body, { status: result.status, headers });
}
