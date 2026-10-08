/**
 * Gallery visibility + entitlement rules, shared by the pages, the download route and
 * face search so there is exactly one place that decides what a viewer may see.
 */
import { prisma, type AlbumVisibility, type Photo, type Prisma } from "@hub/db";
import { storage } from "@hub/shared";
import { t, type Locale } from "@hub/shared/i18n";
import type { KeysetCursor, ScoreCursor } from "./galleryCursor";
import type { Viewer } from "./site";

export type Derivatives = { thumb?: string; web?: string; webWm?: string };

export type PhotoDTO = {
  id: string;
  filename: string;
  width: number | null;
  height: number | null;
  albumId: string | null;
  thumbUrl: string | null;
  /** Clean or watermarked web rendition, chosen by entitlement. */
  webUrl: string | null;
  favorited: boolean;
  canDownload: boolean;
  score?: number;
};

export function visibleVisibilities(viewer: Viewer): AlbumVisibility[] {
  const v: AlbumVisibility[] = ["GUESTS"];
  if (viewer.canHostsOnlyAlbums) v.push("HOSTS_ONLY");
  if (viewer.isStudio) v.push("HIDDEN");
  return v;
}

/** where-fragment for photos this viewer may see in this event. */
export function visiblePhotoWhere(eventId: string, viewer: Viewer, extra: Prisma.PhotoWhereInput = {}): Prisma.PhotoWhereInput {
  return {
    eventId,
    status: "READY",
    hidden: false,
    album: { visibility: { in: visibleVisibilities(viewer) } },
    ...extra,
  };
}

// ───────────────────────── Keyset pagination ─────────────────────────
// Every feed is ordered by a total order and continues strictly after the last row of the previous
// page, so concurrent inserts never shift a page (offsets would). All feeds go through
// visiblePhotoWhere, so hidden photos, album visibility and event scope hold on every page.

export const PAGE_SIZE = 60;
export const MAX_PAGE_SIZE = 100;

export type PageOptions<C> = { cursor?: C; limit?: number };
export type Page<C> = { photos: PhotoDTO[]; nextCursor: C | null };

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

/** `ORDER BY sortKey ASC NULLS LAST, id ASC`: unkeyed photos (not yet processed) sort after keyed ones. */
const BY_SORT_KEY: Prisma.PhotoOrderByWithRelationInput[] = [{ sortKey: { sort: "asc", nulls: "last" } }, { id: "asc" }];

/** Rows strictly after `(sortKey, id)` in BY_SORT_KEY order. */
function afterSortKey(c: KeysetCursor | undefined): Prisma.PhotoWhereInput {
  if (!c) return {};
  if (c.sortKey === null) return { sortKey: null, id: { gt: c.id } };
  return { OR: [{ sortKey: { gt: c.sortKey } }, { sortKey: c.sortKey, id: { gt: c.id } }, { sortKey: null }] };
}

/** One page of photos in sortKey order; `extra` narrows the visible set (album, favorites). */
async function sortKeyPage(eventId: string, viewer: Viewer, extra: Prisma.PhotoWhereInput, opts: PageOptions<KeysetCursor>): Promise<Page<KeysetCursor>> {
  const limit = clampLimit(opts.limit);
  const rows = await prisma.photo.findMany({
    where: visiblePhotoWhere(eventId, viewer, { ...extra, AND: [afterSortKey(opts.cursor)] }),
    orderBy: BY_SORT_KEY,
    take: limit + 1,
  });
  const photos = rows.slice(0, limit);
  const last = photos[photos.length - 1];
  const entitled = await isEntitledFullRes(eventId, viewer.principal.userId);
  return {
    photos: await toPhotoDTOs(photos, viewer, { entitled }),
    nextCursor: rows.length > limit && last ? { sortKey: last.sortKey, id: last.id } : null,
  };
}

export function listAlbumPage(eventId: string, viewer: Viewer, albumId: string, opts: PageOptions<KeysetCursor> = {}) {
  return sortKeyPage(eventId, viewer, { albumId }, opts);
}

/** The viewer's own hearts across the event. */
export function listFavoritesPage(eventId: string, viewer: Viewer, opts: PageOptions<KeysetCursor> = {}) {
  return sortKeyPage(eventId, viewer, { favorites: { some: { userId: viewer.principal.userId } } }, opts);
}

/** Whose face matches to list: the signed-in user's own, or a child guest they search for as guardian. */
export type MatchSubject = { userId: string } | { guestId: string };

/** Rows strictly after `(score, photoId)` in `score DESC, photoId ASC` order. */
function afterScore(c: ScoreCursor | undefined): Prisma.PhotoMatchWhereInput {
  if (!c) return {};
  return { OR: [{ score: { lt: c.score } }, { score: c.score, photoId: { gt: c.id } }] };
}

/** "My photos": previously matched photos, best match first. The score order is the keyset. */
export async function listMatchPage(eventId: string, viewer: Viewer, subject: MatchSubject, opts: PageOptions<ScoreCursor> = {}): Promise<Page<ScoreCursor>> {
  const limit = clampLimit(opts.limit);
  const rows = await prisma.photoMatch.findMany({
    where: {
      ...("userId" in subject ? { userId: subject.userId } : { subjectGuestId: subject.guestId }),
      photo: visiblePhotoWhere(eventId, viewer),
      AND: [afterScore(opts.cursor)],
    },
    orderBy: [{ score: "desc" }, { photoId: "asc" }],
    take: limit + 1,
    include: { photo: true },
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const entitled = await isEntitledFullRes(eventId, viewer.principal.userId);
  return {
    photos: await toPhotoDTOs(
      page.map((m) => m.photo),
      viewer,
      { entitled, scores: new Map(page.map((m) => [m.photoId, m.score])) },
    ),
    nextCursor: rows.length > limit && last ? { score: last.score, id: last.photoId } : null,
  };
}

/** Photos in the album this viewer may list (the header total; pages are fetched separately). */
export function countAlbumPhotos(eventId: string, viewer: Viewer, albumId: string) {
  return prisma.photo.count({ where: visiblePhotoWhere(eventId, viewer, { albumId }) });
}

export async function listVisibleAlbums(eventId: string, viewer: Viewer, locale: Locale) {
  const albums = await prisma.album.findMany({
    where: { eventId, visibility: { in: visibleVisibilities(viewer) } },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { photos: { where: { status: "READY", hidden: false } } } } },
  });
  const covers = await Promise.all(
    albums.map(async (a) => {
      const cover =
        (a.coverPhotoId ? await prisma.photo.findFirst({ where: { id: a.coverPhotoId, status: "READY", hidden: false } }) : null) ??
        (await prisma.photo.findFirst({ where: { albumId: a.id, status: "READY", hidden: false }, orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }] }));
      const d = (cover?.derivatives ?? {}) as Derivatives;
      return d.thumb ? await storage.derivativeUrl(d.thumb) : null;
    }),
  );
  return albums.map((a, i) => ({ id: a.id, title: t(a.title as object, locale), count: a._count.photos, coverUrl: covers[i], visibility: a.visibility }));
}

/** GALLERY_FULLRES for everyone (userId null) or for this viewer, not revoked. */
export async function isEntitledFullRes(eventId: string, userId: string) {
  const e = await prisma.entitlement.findFirst({
    where: { eventId, scope: "GALLERY_FULLRES", revokedAt: null, OR: [{ userId: null }, { userId }] },
    select: { id: true },
  });
  return !!e;
}

export async function toPhotoDTOs(photos: Photo[], viewer: Viewer, opts: { entitled: boolean; scores?: Map<string, number> }): Promise<PhotoDTO[]> {
  const favs = photos.length
    ? await prisma.favorite.findMany({ where: { userId: viewer.principal.userId, photoId: { in: photos.map((p) => p.id) } }, select: { photoId: true } })
    : [];
  const favSet = new Set(favs.map((f) => f.photoId));
  return Promise.all(
    photos.map(async (p) => {
      const d = (p.derivatives ?? {}) as Derivatives;
      const webKey = opts.entitled ? (d.web ?? d.webWm) : (d.webWm ?? d.web);
      return {
        id: p.id,
        filename: p.filename,
        width: p.width,
        height: p.height,
        albumId: p.albumId,
        thumbUrl: d.thumb ? await storage.derivativeUrl(d.thumb) : null,
        webUrl: webKey ? await storage.derivativeUrl(webKey) : null,
        favorited: favSet.has(p.id),
        canDownload: opts.entitled,
        score: opts.scores?.get(p.id),
      };
    }),
  );
}
