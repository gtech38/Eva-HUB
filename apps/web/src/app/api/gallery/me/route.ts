// tdd-exempt: route shell; behaviour is tested in lib/galleryFeed.test.ts
import type { NextRequest } from "next/server";
import { handleGalleryFeed } from "@/lib/galleryFeedRoute";

export const dynamic = "force-dynamic";

/** Next page of previously matched photos: `GET /api/gallery/me?subject=<me|childGuestId>&cursor=`. */
export async function GET(req: NextRequest) {
  return handleGalleryFeed(req, { kind: "me", subject: req.nextUrl.searchParams.get("subject") });
}
