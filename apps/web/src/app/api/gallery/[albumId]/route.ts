// tdd-exempt: route shell; behaviour is tested in lib/galleryFeed.test.ts
import type { NextRequest } from "next/server";
import { handleGalleryFeed } from "@/lib/galleryFeedRoute";

export const dynamic = "force-dynamic";

/** Next page of an album: `GET /api/gallery/<albumId>?cursor=`. Visibility and entitlement are re-checked on every page. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await ctx.params;
  return handleGalleryFeed(req, { kind: "album", albumId });
}
