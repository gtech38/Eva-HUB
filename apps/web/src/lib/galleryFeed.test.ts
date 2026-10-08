/**
 * The request-level rules behind GET /api/gallery/*: who may page which feed, cursor validation,
 * and that the album endpoint never reveals photos from albums the viewer cannot see.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { createGalleryFixture, dbReachable, fakeViewer, VISIBLE_IN_MAIN } from "../../test/galleryFixture";
import { decodeCursor } from "./galleryCursor";
import { galleryFeed, type FeedContext, type FeedResult } from "./galleryFeed";
import type { Viewer } from "./site";

const dbUp = await dbReachable();
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const suite = dbUp ? "gallery feed requests against Postgres" : `gallery feed requests against Postgres [skipped: Postgres unreachable at ${dbHost}; run pnpm infra:up]`;

let fx: Awaited<ReturnType<typeof createGalleryFixture>>;
const household: { id?: string; mine?: string; other?: string; optedOut?: string; adult?: string } = {};

beforeAll(async () => {
  if (!dbUp) return;
  fx = await createGalleryFixture();
  const mk = (name: string) => prisma.household.create({ data: { studioId: fx.studio.id, eventId: fx.eventA.id, name: `${fx.run} ${name}` } });
  const [home, away] = [await mk("home"), await mk("away")];
  household.id = home.id;
  const guest = (householdId: string, data: { isChild?: boolean; faceSearchOptOut?: boolean; userId?: string }) =>
    prisma.guest.create({ data: { studioId: fx.studio.id, eventId: fx.eventA.id, householdId, firstName: "G", ...data } });
  household.adult = (await guest(home.id, { userId: fx.users.viewer.id })).id;
  household.mine = (await guest(home.id, { isChild: true })).id;
  household.optedOut = (await guest(home.id, { isChild: true, faceSearchOptOut: true })).id;
  household.other = (await guest(away.id, { isChild: true })).id;
}, 60_000);

afterAll(async () => {
  if (dbUp && fx) {
    await prisma.guest.deleteMany({ where: { eventId: fx.eventA.id } });
    await prisma.household.deleteMany({ where: { eventId: fx.eventA.id } });
    await fx.cleanup();
  }
  await prisma.$disconnect();
});

const ctx = (over: { viewer?: Partial<Viewer>; status?: "LIVE" | "DRAFT"; faceSearchEnabled?: boolean; faceSearchAllowed?: boolean } = {}): FeedContext => ({
  event: { id: fx.eventA.id, status: over.status ?? "LIVE", faceSearchEnabled: over.faceSearchEnabled ?? true },
  viewer: fakeViewer(fx.users.viewer.id, over.viewer),
  faceSearchAllowed: over.faceSearchAllowed ?? true,
});

function ok(r: FeedResult) {
  expect(r.status).toBe(200);
  if (!r.body.ok) throw new Error(`expected ok, got ${r.body.reason}`);
  return r.body;
}

describe.skipIf(!dbUp)(suite, () => {
  describe("album feed", () => {
    it("serves the first page with an opaque cursor and the rest through it, 125 photos in all", async () => {
      const first = ok(await galleryFeed(ctx(), { kind: "album", albumId: fx.albums.main.id }, null));
      expect(first.photos).toHaveLength(60);
      expect(first.nextCursor).toBeTypeOf("string");
      expect(decodeCursor(first.nextCursor!)).toEqual({ sortKey: expect.any(String), id: first.photos[59].id });

      const second = ok(await galleryFeed(ctx(), { kind: "album", albumId: fx.albums.main.id }, first.nextCursor));
      const third = ok(await galleryFeed(ctx(), { kind: "album", albumId: fx.albums.main.id }, second.nextCursor));
      expect(third.nextCursor).toBeNull();
      expect([...first.photos, ...second.photos, ...third.photos].map((p) => p.id)).toEqual(fx.expectedMainOrder);
      expect(VISIBLE_IN_MAIN).toBe(125);
    });

    it("a viewer who cannot see HOSTS_ONLY gets 404 and none of those photos", async () => {
      const r = await galleryFeed(ctx(), { kind: "album", albumId: fx.albums.hostsOnly.id }, null);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain(fx.hostsOnlyIds[0]);
    });

    it("a host can page the HOSTS_ONLY album; the HIDDEN album stays 404 for hosts and opens for the studio", async () => {
      const host = ctx({ viewer: { canHostsOnlyAlbums: true } });
      expect(ok(await galleryFeed(host, { kind: "album", albumId: fx.albums.hostsOnly.id }, null)).photos.map((p) => p.id)).toEqual(fx.hostsOnlyIds);
      expect((await galleryFeed(host, { kind: "album", albumId: fx.albums.hidden.id }, null)).status).toBe(404);
      const studio = ctx({ viewer: { canHostsOnlyAlbums: true, isStudio: true } });
      expect(ok(await galleryFeed(studio, { kind: "album", albumId: fx.albums.hidden.id }, null)).photos.map((p) => p.id)).toEqual(fx.hiddenAlbumIds);
    });

    it("404s an album of another event, even for the studio", async () => {
      const studio = ctx({ viewer: { canHostsOnlyAlbums: true, isStudio: true } });
      expect((await galleryFeed(studio, { kind: "album", albumId: fx.albums.otherEvent.id }, null)).status).toBe(404);
    });

    it.each(["not-base64!", "Zm9v", "", "x".repeat(500)])("rejects the malformed cursor %j with 400 before querying", async (raw) => {
      const r = await galleryFeed(ctx(), { kind: "album", albumId: fx.albums.main.id }, raw);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ ok: false, reason: "bad_cursor" });
    });

    it("403s a viewer without gallery.view, and non-staff while the event is not LIVE", async () => {
      expect((await galleryFeed(ctx({ viewer: { can: () => false } }), { kind: "album", albumId: fx.albums.main.id }, null)).status).toBe(403);
      const draft = await galleryFeed(ctx({ status: "DRAFT" }), { kind: "album", albumId: fx.albums.main.id }, null);
      expect(draft.status).toBe(403);
      expect(draft.body).toEqual({ ok: false, reason: "not_live" });
      expect((await galleryFeed(ctx({ status: "DRAFT", viewer: { seesAllSubEvents: true } }), { kind: "album", albumId: fx.albums.main.id }, null)).status).toBe(200);
    });
  });

  describe("favorites feed", () => {
    it("pages only the viewer's favorites and requires the favorites action", async () => {
      await prisma.favorite.createMany({ data: fx.expectedMainOrder.slice(0, 3).map((photoId) => ({ userId: fx.users.viewer.id, photoId })) });
      expect(ok(await galleryFeed(ctx(), { kind: "favorites" }, null)).photos.map((p) => p.id)).toEqual(fx.expectedMainOrder.slice(0, 3));
      const denied = ctx({ viewer: { can: (a) => a !== "favorites" } });
      expect((await galleryFeed(denied, { kind: "favorites" }, null)).status).toBe(403);
    });
  });

  describe("My photos feed", () => {
    const withGuest = (extra: Partial<Viewer> = {}) => ({
      viewer: { guest: { id: household.adult, householdId: household.id } as unknown as Viewer["guest"], ...extra },
    });

    it("pages the signed-in user's own matches by score for subject 'me'", async () => {
      await prisma.photoMatch.createMany({
        data: [
          { photoId: fx.expectedMainOrder[5], userId: fx.users.viewer.id, source: "SELFIE", score: 0.7 },
          { photoId: fx.expectedMainOrder[6], userId: fx.users.viewer.id, source: "SELFIE", score: 0.9 },
          { photoId: fx.expectedMainOrder[7], userId: fx.users.other.id, source: "SELFIE", score: 0.99 },
        ],
      });
      const r = ok(await galleryFeed(ctx(), { kind: "me", subject: "me" }, null));
      expect(r.photos.map((p) => p.id)).toEqual([fx.expectedMainOrder[6], fx.expectedMainOrder[5]]);
      expect(r.photos[0].score).toBe(0.9);
    });

    it("pages a child's matches for a guardian in the same household only", async () => {
      await prisma.photoMatch.create({ data: { photoId: fx.expectedMainOrder[9], subjectGuestId: household.mine!, source: "GUARDIAN", score: 0.8 } });
      const mine = ok(await galleryFeed(ctx(withGuest()), { kind: "me", subject: household.mine! }, null));
      expect(mine.photos.map((p) => p.id)).toEqual([fx.expectedMainOrder[9]]);
    });

    it.each([
      ["a child in another household", () => household.other!],
      ["a child who opted out of face search", () => household.optedOut!],
      ["an adult guest", () => household.adult!],
      ["an unknown id", () => "nope"],
    ])("404s subject %s", async (_name, subject) => {
      const r = await galleryFeed(ctx(withGuest()), { kind: "me", subject: subject() }, null);
      expect(r.status).toBe(404);
    });

    it("404s a child subject for a viewer with no guest row", async () => {
      expect((await galleryFeed(ctx(), { kind: "me", subject: household.mine! }, null)).status).toBe(404);
    });

    it("is closed when face search is off for the event, not allowed, or the viewer lacks face.search", async () => {
      for (const c of [ctx({ faceSearchEnabled: false }), ctx({ faceSearchAllowed: false }), ctx({ viewer: { can: (a) => a !== "face.search" } })]) {
        const r = await galleryFeed(c, { kind: "me", subject: "me" }, null);
        expect(r.status).toBe(403);
      }
    });
  });
});
