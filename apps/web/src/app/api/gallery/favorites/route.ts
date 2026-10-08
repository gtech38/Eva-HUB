// tdd-exempt: route shell; behaviour is tested in lib/galleryFeed.test.ts
import type { NextRequest } from "next/server";
import { handleGalleryFeed } from "@/lib/galleryFeedRoute";

export const dynamic = "force-dynamic";

/** Next page of the viewer's favorites: `GET /api/gallery/favorites?cursor=`. */
export async function GET(req: NextRequest) {
  return handleGalleryFeed(req, { kind: "favorites" });
}
