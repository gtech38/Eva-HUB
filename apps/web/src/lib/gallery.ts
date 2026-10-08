/**
 * Gallery visibility + entitlement rules, shared by the pages, the download route and
 * face search so there is exactly one place that decides what a viewer may see.
 */
import { prisma, type AlbumVisibility, type Photo, type Prisma } from "@hub/db";
import { storage } from "@hub/shared";
import { t, type Locale } from "@hub/shared/i18n";
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
