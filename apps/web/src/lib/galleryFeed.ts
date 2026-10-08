/**
 * Request-level rules for the paged gallery endpoints (`/api/gallery/*`): who may read which feed,
 * cursor validation, and the JSON shape. The route files are wiring around `galleryFeed`; the
 * visibility and entitlement decisions stay in `gallery.ts` (`visiblePhotoWhere`, `toPhotoDTOs`)
 * and the guardian rule in `faceSubject.ts`.
 */
import type { EventStatus, Guest } from "@hub/db";
import { findVisibleAlbum, listAlbumPage, listFavoritesPage, listMatchPage, type MatchSubject, type Page, type PhotoDTO } from "./gallery";
import { decodeCursor, decodeScoreCursor, encodeCursor, encodeScoreCursor, type ScoreCursor } from "./galleryCursor";
import { listSearchableChildren, resolveFaceSubject } from "./faceSubject";
import type { Viewer } from "./site";

export type Feed = { kind: "album"; albumId: string } | { kind: "favorites" } | { kind: "me"; subject: string | null };

export type FeedContext = {
  event: { id: string; status: EventStatus; faceSearchEnabled: boolean };
  viewer: Viewer;
  /** `faceSearchAllowed(NODE_ENV)`: the production guard on unreviewed consent texts. */
  faceSearchAllowed: boolean;
};

export type FeedFailure = "forbidden" | "not_live" | "not_found" | "bad_cursor" | "opted_out";
export type FeedResult =
  | { status: 200; body: { ok: true; photos: PhotoDTO[]; nextCursor: string | null } }
  | { status: 400 | 403 | 404; body: { ok: false; reason: FeedFailure } };

const fail = (status: 400 | 403 | 404, reason: FeedFailure): FeedResult => ({ status, body: { ok: false, reason } });
const okPage = (photos: PhotoDTO[], nextCursor: string | null): FeedResult => ({ status: 200, body: { ok: true, photos, nextCursor } });

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
    const who = await resolveFaceSubject(viewer, event.id, feed.subject);
    // An unknown or foreign child is a 404, so ids in other households cannot be probed.
    if (!who.ok) return who.reason === "opted_out" ? fail(403, "opted_out") : fail(404, "not_found");
    const subject: MatchSubject = who.subject.kind === "me" ? { userId: viewer.principal.userId } : { guestId: who.subject.guestId };
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
  const album = await findVisibleAlbum(event.id, viewer, feed.albumId);
  if (!album) return fail(404, "not_found");
  const page = await listAlbumPage(event.id, viewer, album.id, { cursor: after });
  return okPage(page.photos, page.nextCursor && encodeCursor(page.nextCursor));
}

/**
 * First pages of earlier matches for /gallery/me: the viewer's own (none if they opted out of face
 * search, since nothing purges old PhotoMatch rows on opt-out) and each searchable child's.
 */
export async function previousMatchFeeds(ctx: FeedContext): Promise<{
  me: Page<ScoreCursor>;
  family: Array<{ child: Guest; page: Page<ScoreCursor> }>;
}> {
  const { event, viewer } = ctx;
  const self = await resolveFaceSubject(viewer, event.id, "me");
  const me = self.ok ? await listMatchPage(event.id, viewer, { userId: viewer.principal.userId }) : { photos: [], nextCursor: null };
  const children = await listSearchableChildren(viewer, event.id);
  const family = await Promise.all(children.map(async (child) => ({ child, page: await listMatchPage(event.id, viewer, { guestId: child.id }) })));
  return { me, family };
}
