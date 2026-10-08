/**
 * Page wiring against Postgres: the real album page, loaders and queries run on a self-seeded
 * event; only the session gate, `notFound()` and the favorite server action are stubbed.
 * Skipped without Postgres locally; fails when CI is set (see test/galleryFixture.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@hub/db";
import { createGalleryFixture, dbReachable, failInCiWithoutPostgres, fakeViewer } from "../../../../../../test/galleryFixture";
import type { Viewer } from "@/lib/site";

const gate = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/site", () => ({ requireViewer: async () => gate.current }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/sites/[slug]/gallery/actions", () => ({ toggleFavorite: vi.fn() }));

const { default: AlbumPage } = await import("./page");

const dbUp = await dbReachable();
failInCiWithoutPostgres("album page", dbUp);
vi.setConfig({ testTimeout: 30_000 }); // 2,000 seeded photos; see lib/gallery.test.ts

const BIG = 2000;
const imgCount = (html: string) => (html.match(/<img\b/g) ?? []).length;

describe.skipIf(!dbUp)("album page: first page only", () => {
  let fx: Awaited<ReturnType<typeof createGalleryFixture>>;
  let bigAlbumId = "";
  beforeAll(async () => {
    fx = await createGalleryFixture();
    const album = await prisma.album.create({ data: { studioId: fx.studio.id, eventId: fx.eventA.id, title: { en: "Big" }, visibility: "GUESTS" } });
    bigAlbumId = album.id;
    await prisma.photo.createMany({
      data: Array.from({ length: BIG }, (_, i) => {
        const id = `${fx.run}-big${String(i).padStart(4, "0")}`;
        return {
          id,
          studioId: fx.studio.id,
          eventId: fx.eventA.id,
          albumId: album.id,
          originalKey: `${fx.run}/o/${id}`,
          originalBytes: BigInt(1),
          checksum: id,
          filename: `${id}.jpg`,
          status: "READY" as const,
          sortKey: new Date(Date.UTC(2026, 9, 8, 10, 0, 0) + i * 1000).toISOString().slice(0, 23),
          derivatives: { thumb: `${fx.run}/d/${id}-t.jpg`, web: `${fx.run}/d/${id}-w.jpg`, webWm: `${fx.run}/d/${id}-wm.jpg` },
        };
      }),
    });
  }, 120_000);
  afterAll(async () => {
    if (fx) await fx.cleanup();
    await prisma.$disconnect();
  });

  const render = async (albumId: string, viewer: Viewer = fakeViewer(fx.users.viewer.id)) => {
    gate.current = { event: fx.eventA, locale: "en", viewer };
    return renderToStaticMarkup(await AlbumPage({ params: Promise.resolve({ albumId }) }));
  };

  it("a 2,000-photo album renders at most 60 <img> tags and shows the true total", async () => {
    const html = await render(bigAlbumId);
    expect(imgCount(html)).toBeLessThanOrEqual(60);
    expect(imgCount(html)).toBe(60);
    expect(html).toContain(`${BIG} photos`);
  });

  it("hands the grid a sentinel so the rest loads from /api/gallery/<albumId>", async () => {
    const html = await render(bigAlbumId);
    expect(html).toContain("aria-live"); // the sentinel only renders while a next cursor exists
    expect(html).not.toContain(`${fx.run}-big0060`); // photo 61 is not in the first page
  });

  it("404s a HOSTS_ONLY album for a plain guest and renders it for a host", async () => {
    await expect(render(fx.albums.hostsOnly.id)).rejects.toThrow("NEXT_NOT_FOUND");
    const html = await render(fx.albums.hostsOnly.id, fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: true }));
    expect(imgCount(html)).toBe(fx.hostsOnlyIds.length);
  });

  it("404s an album that belongs to another event", async () => {
    await expect(render(fx.albums.otherEvent.id, fakeViewer(fx.users.viewer.id, { canHostsOnlyAlbums: true, isStudio: true }))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
