/**
 * Postgres-backed tests for the gallery feeds (keyset pagination) and the visibility and
 * entitlement rules they sit on. Needs the local stack; skipped with a reason when Postgres is down.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { VISIBLE_IN_MAIN, createGalleryFixture, dbReachable, fakeViewer } from "../../test/galleryFixture";
import { countAlbumPhotos, listAlbumPage, listFavoritesPage, listMatchPage, MAX_PAGE_SIZE, PAGE_SIZE, type PhotoDTO } from "./gallery";
import type { KeysetCursor } from "./galleryCursor";

const dbUp = await dbReachable();
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const suite = dbUp ? "gallery feeds against Postgres" : `gallery feeds against Postgres [skipped: Postgres unreachable at ${dbHost}; run pnpm infra:up]`;

type Fixture = Awaited<ReturnType<typeof createGalleryFixture>>;
let fx: Fixture;

beforeAll(async () => {
  if (dbUp) fx = await createGalleryFixture();
}, 60_000);

afterAll(async () => {
  if (dbUp && fx) await fx.cleanup();
  await prisma.$disconnect();
});

/** Walk every page of a feed, returning the pages (so tests can assert sizes and boundaries). */
async function walk<C>(fetchPage: (cursor?: C) => Promise<{ photos: PhotoDTO[]; nextCursor: C | null }>) {
  const pages: PhotoDTO[][] = [];
  let cursor: C | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const page = await fetchPage(cursor);
    pages.push(page.photos);
    if (!page.nextCursor) return pages;
    cursor = page.nextCursor;
  }
  throw new Error("feed did not terminate");
}

describe.skipIf(!dbUp)(suite, () => {
  describe("listAlbumPage", () => {
    it("pages through 125 fixture photos in pages of 60 with no gaps or duplicates", async () => {
      const viewer = fakeViewer(fx.users.viewer.id);
      const pages = await walk((cursor) => listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { cursor, limit: 60 }));
      expect(pages.map((p) => p.length)).toEqual([60, 60, 5]);
      const ids = pages.flat().map((p) => p.id);
      expect(new Set(ids).size).toBe(VISIBLE_IN_MAIN);
      expect(ids).toEqual(fx.expectedMainOrder);
    });

    it("defaults to PAGE_SIZE (60) photos per page", async () => {
      expect(PAGE_SIZE).toBe(60);
      const page = await listAlbumPage(fx.eventA.id, fakeViewer(fx.users.viewer.id), fx.albums.main.id);
      expect(page.photos).toHaveLength(60);
      expect(page.nextCursor).toEqual({ sortKey: expect.any(String), id: page.photos[59].id });
    });

    it("returns a null nextCursor when the last page is exactly full", async () => {
      const viewer = fakeViewer(fx.users.viewer.id);
      const pages = await walk((cursor) => listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { cursor, limit: 25 }));
      expect(pages.map((p) => p.length)).toEqual([25, 25, 25, 25, 25]);
    });

    it("keeps photos without a sortKey (listed last) even when the cursor itself has a null sortKey", async () => {
      const viewer = fakeViewer(fx.users.viewer.id);
      const pages = await walk((cursor) => listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { cursor, limit: 2 }));
      expect(pages.flat().map((p) => p.id)).toEqual(fx.expectedMainOrder);
    });

    it("clamps the page size to 1..MAX_PAGE_SIZE", async () => {
      const viewer = fakeViewer(fx.users.viewer.id);
      expect((await listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { limit: 100000 })).photos).toHaveLength(MAX_PAGE_SIZE);
      expect((await listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { limit: 0 })).photos).toHaveLength(1);
      expect((await listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { limit: Number.NaN })).photos).toHaveLength(PAGE_SIZE);
    });

    it("never lists hidden photos or photos that are not READY", async () => {
      const viewer = fakeViewer(fx.users.viewer.id);
      const pages = await walk((cursor) => listAlbumPage(fx.eventA.id, viewer, fx.albums.main.id, { cursor, limit: 100 }));
      const ids = pages.flat().map((p) => p.id);
      expect(ids.some((i) => i.includes("-h") || i.includes("-u"))).toBe(false);
      expect(ids).toHaveLength(VISIBLE_IN_MAIN);
    });

    it("lists nothing from a HOSTS_ONLY album for a viewer who cannot see it", async () => {
      const guest = fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: false });
      expect((await listAlbumPage(fx.eventA.id, guest, fx.albums.hostsOnly.id)).photos).toEqual([]);
    });

    it("lists HOSTS_ONLY photos for a host, and HIDDEN-album photos only for the studio", async () => {
      const host = fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: true });
      expect((await listAlbumPage(fx.eventA.id, host, fx.albums.hostsOnly.id)).photos.map((p) => p.id)).toEqual(fx.hostsOnlyIds);
      expect((await listAlbumPage(fx.eventA.id, host, fx.albums.hidden.id)).photos).toEqual([]);
      const studio = fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: true, isStudio: true });
      expect((await listAlbumPage(fx.eventA.id, studio, fx.albums.hidden.id)).photos.map((p) => p.id)).toEqual(fx.hiddenAlbumIds);
    });

    it("is scoped to the event: another event's album yields nothing, whoever asks", async () => {
      const studio = fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: true, isStudio: true });
      expect((await listAlbumPage(fx.eventA.id, studio, fx.albums.otherEvent.id)).photos).toEqual([]);
      expect((await listAlbumPage(fx.eventB.id, studio, fx.albums.otherEvent.id)).photos.map((p) => p.id)).toEqual(fx.otherEventIds);
    });
  });

  describe("countAlbumPhotos", () => {
    it("counts only the photos this viewer may list in the album", async () => {
      expect(await countAlbumPhotos(fx.eventA.id, fakeViewer(fx.users.viewer.id), fx.albums.main.id)).toBe(VISIBLE_IN_MAIN);
      expect(await countAlbumPhotos(fx.eventA.id, fakeViewer(fx.users.viewer.id), fx.albums.hostsOnly.id)).toBe(0);
      expect(await countAlbumPhotos(fx.eventA.id, fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: true }), fx.albums.hostsOnly.id)).toBe(4);
    });
  });

  describe("listFavoritesPage", () => {
    it("pages the viewer's favorites in sortKey order and skips hidden, hosts-only, other-user and other-event photos", async () => {
      const mine = fx.expectedMainOrder.slice(0, 70);
      const hiddenId = `${fx.run}-h000`;
      const strays = [hiddenId, fx.hostsOnlyIds[0], fx.otherEventIds[0]];
      await prisma.favorite.createMany({
        data: [...mine, ...strays].map((photoId) => ({ userId: fx.users.viewer.id, photoId })).concat(
          [{ userId: fx.users.other.id, photoId: fx.expectedMainOrder[100] }],
        ),
      });
      const viewer = fakeViewer(fx.users.viewer.id);
      const pages = await walk((cursor) => listFavoritesPage(fx.eventA.id, viewer, { cursor, limit: 60 }));
      expect(pages.map((p) => p.length)).toEqual([60, 10]);
      expect(pages.flat().map((p) => p.id)).toEqual(mine);
      expect(pages.flat().every((p) => p.favorited)).toBe(true);
    });
  });

  describe("listMatchPage", () => {
    const scoreFor = (i: number) => 1 - Math.floor(i / 5) / 100; // five-way score ties exercise the id tiebreak

    it("pages the viewer's matches by score desc then photo id, with no gaps or duplicates", async () => {
      const mine = fx.expectedMainOrder.slice(0, 70);
      const hiddenId = `${fx.run}-h001`;
      const strays = [hiddenId, fx.hostsOnlyIds[1], fx.otherEventIds[1]];
      await prisma.photoMatch.createMany({
        data: [
          ...mine.map((photoId, i) => ({ photoId, userId: fx.users.viewer.id, source: "SELFIE" as const, score: scoreFor(i) })),
          ...strays.map((photoId) => ({ photoId, userId: fx.users.viewer.id, source: "SELFIE" as const, score: 0.999 })),
          { photoId: fx.expectedMainOrder[80], userId: fx.users.other.id, source: "SELFIE" as const, score: 0.99 },
          { photoId: fx.expectedMainOrder[81], subjectGuestId: `${fx.run}-g1`, source: "GUARDIAN" as const, score: 0.98 },
        ],
      });
      const expected = [...mine.map((id, i) => ({ id, score: scoreFor(i) }))]
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
        .map((m) => m.id);

      const viewer = fakeViewer(fx.users.viewer.id);
      const pages = await walk((cursor) => listMatchPage(fx.eventA.id, viewer, { userId: fx.users.viewer.id }, { cursor, limit: 60 }));
      expect(pages.map((p) => p.length)).toEqual([60, 10]);
      expect(pages.flat().map((p) => p.id)).toEqual(expected);
      expect(pages.flat()[0].score).toBe(1);

      const family = await listMatchPage(fx.eventA.id, viewer, { guestId: `${fx.run}-g1` });
      expect(family.photos.map((p) => p.id)).toEqual([fx.expectedMainOrder[81]]);
    });

    it("returns a guardian subject's matches only for photos in this event and visible to the viewer", async () => {
      await prisma.photoMatch.createMany({
        data: [fx.expectedMainOrder[0], fx.hostsOnlyIds[2], fx.otherEventIds[2]].map((photoId, i) => ({
          photoId,
          subjectGuestId: `${fx.run}-g2`,
          source: "GUARDIAN" as const,
          score: 0.9 - i / 100,
        })),
      });
      const page = await listMatchPage(fx.eventA.id, fakeViewer(fx.users.viewer.id), { guestId: `${fx.run}-g2` });
      expect(page.photos.map((p) => p.id)).toEqual([fx.expectedMainOrder[0]]);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe("entitlements decide clean vs watermarked renditions", () => {
    const first = async (viewerId: string) =>
      (await listAlbumPage(fx.eventA.id, fakeViewer(viewerId), fx.albums.main.id, { limit: 1 })).photos[0];
    const grant = (data: { userId?: string | null; eventId?: string; revokedAt?: Date }) =>
      prisma.entitlement.create({ data: { eventId: fx.eventA.id, scope: "GALLERY_FULLRES", ...data } });
    afterEach(async () => {
      await prisma.entitlement.deleteMany({ where: { eventId: { in: [fx.eventA.id, fx.eventB.id] } } });
    });

    it("serves the watermarked rendition and no download without an entitlement", async () => {
      const p = await first(fx.users.viewer.id);
      expect(p.canDownload).toBe(false);
      expect(p.webUrl).toContain(`${p.id}-wm.jpg`);
    });

    it("serves the clean rendition and download for an event-wide entitlement", async () => {
      await grant({ userId: null });
      const p = await first(fx.users.viewer.id);
      expect(p.canDownload).toBe(true);
      expect(p.webUrl).toContain(`${p.id}-w.jpg`);
    });

    it("honours a per-user entitlement for that user only", async () => {
      await grant({ userId: fx.users.viewer.id });
      expect((await first(fx.users.viewer.id)).canDownload).toBe(true);
      expect((await first(fx.users.other.id)).canDownload).toBe(false);
    });

    it("ignores revoked entitlements and entitlements granted for another event", async () => {
      await grant({ userId: null, revokedAt: new Date() });
      await grant({ userId: null, eventId: fx.eventB.id });
      expect((await first(fx.users.viewer.id)).canDownload).toBe(false);
    });
  });
});
