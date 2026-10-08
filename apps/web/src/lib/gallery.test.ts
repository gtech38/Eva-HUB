/**
 * Postgres-backed tests for the gallery feeds (keyset pagination) and the visibility and
 * entitlement rules they sit on. Needs the local stack; skipped with a reason when Postgres is down.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { VISIBLE_IN_MAIN, createGalleryFixture, dbReachable, fakeViewer } from "../../test/galleryFixture";
import { countAlbumPhotos, listAlbumPage, MAX_PAGE_SIZE, PAGE_SIZE, type PhotoDTO } from "./gallery";
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
async function walk(fetchPage: (cursor?: KeysetCursor) => Promise<{ photos: PhotoDTO[]; nextCursor: KeysetCursor | null }>) {
  const pages: PhotoDTO[][] = [];
  let cursor: KeysetCursor | undefined;
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
});
