/**
 * Request-level rules for the paged gallery endpoints (`/api/gallery/*`): who may read which feed,
 * cursor validation, and the JSON shape. The route files are wiring around `galleryFeed`; the
 * visibility and entitlement decisions stay in `gallery.ts` (`visiblePhotoWhere`, `toPhotoDTOs`).
 */
import { prisma } from "@hub/db";
import { listAlbumPage, listFavoritesPage, listMatchPage, visibleVisibilities, type MatchSubject, type PhotoDTO } from "./gallery";
import { decodeCursor, decodeScoreCursor, encodeCursor, encodeScoreCursor } from "./galleryCursor";
import type { Viewer } from "./site";

export type Feed = { kind: "album"; albumId: string } | { kind: "favorites" } | { kind: "me"; subject: string | null };

export type FeedContext = {
  event: { id: string; status: string; faceSearchEnabled: boolean };
  viewer: Viewer;
  /** `faceSearchAllowed(NODE_ENV)`: the production guard on unreviewed consent texts. */
  faceSearchAllowed: boolean;
};

export type FeedFailure = "forbidden" | "not_live" | "not_found" | "bad_cursor";
export type FeedResult =
  | { status: 200; body: { ok: true; photos: PhotoDTO[]; nextCursor: string | null } }
  | { status: 400 | 403 | 404; body: { ok: false; reason: FeedFailure } };

const fail = (status: 400 | 403 | 404, reason: FeedFailure): FeedResult => ({ status, body: { ok: false, reason } });
const okPage = (photos: PhotoDTO[], nextCursor: string | null): FeedResult => ({ status: 200, body: { ok: true, photos, nextCursor } });

/** "me" is the signed-in user; anything else must be a child in the viewer's own household who has not opted out. */
async function resolveSubject(ctx: FeedContext, subject: string | null): Promise<MatchSubject | null> {
  if (subject === null || subject === "me") return { userId: ctx.viewer.principal.userId };
  if (!ctx.viewer.guest) return null;
  const child = await prisma.guest.findFirst({
    where: { id: subject, eventId: ctx.event.id, householdId: ctx.viewer.guest.householdId, isChild: true, deletedAt: null, faceSearchOptOut: false },
    select: { id: true },
  });
  return child ? { guestId: child.id } : null;
}

/** One page of a feed for this viewer. `cursor` is the raw query value (null when absent). */
export async function galleryFeed(ctx: FeedContext, feed: Feed, cursor: string | null): Promise<FeedResult> {
  const { event, viewer } = ctx;
  if (!viewer.can("gallery.view")) return fail(403, "forbidden");
  // Pages are protected by the layout's "not live yet" screen; API routes bypass the layout.
  if (event.status !== "LIVE" && !viewer.seesAllSubEvents) return fail(403, "not_live");

  if (feed.kind === "me") {
    if (!event.faceSearchEnabled || !ctx.faceSearchAllowed || !viewer.can("face.search")) return fail(403, "forbidden");
    const after = cursor === null ? undefined : decodeScoreCursor(cursor);
    if (after === null) return fail(400, "bad_cursor");
    const subject = await resolveSubject(ctx, feed.subject);
    if (!subject) return fail(404, "not_found");
    const page = await listMatchPage(event.id, viewer, subject, { cursor: after });
    return okPage(page.photos, page.nextCursor && encodeScoreCursor(page.nextCursor));
  }

  const after = cursor === null ? undefined : decodeCursor(cursor);
  if (after === null) return fail(400, "bad_cursor");

  if (feed.kind === "favorites") {
    if (!viewer.can("favorites")) return fail(403, "forbidden");
    const page = await listFavoritesPage(event.id, viewer, { cursor: after });
    return okPage(page.photos, page.nextCursor && encodeCursor(page.nextCursor));
  }

  // 404, not 403, for albums outside the viewer's visibility: it must not reveal they exist.
  const album = await prisma.album.findFirst({
    where: { id: feed.albumId, eventId: event.id, visibility: { in: visibleVisibilities(viewer) } },
    select: { id: true },
  });
  if (!album) return fail(404, "not_found");
  const page = await listAlbumPage(event.id, viewer, album.id, { cursor: after });
  return okPage(page.photos, page.nextCursor && encodeCursor(page.nextCursor));
}
