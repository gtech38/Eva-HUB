/**
 * The request-level rules behind GET /api/gallery/*: who may page which feed, cursor validation,
 * and that the album endpoint never reveals photos from albums the viewer cannot see.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@hub/db";
import { createGalleryFixture, dbReachable, failInCiWithoutPostgres, fakeViewer, VISIBLE_IN_MAIN } from "../../test/galleryFixture";
import { decodeCursor } from "./galleryCursor";
import { galleryFeed, previousMatchFeeds, type FeedContext, type FeedResult } from "./galleryFeed";
import type { Viewer } from "./site";

const dbUp = await dbReachable();
failInCiWithoutPostgres("gallery feed requests against Postgres", dbUp);
vi.setConfig({ testTimeout: 30_000 }); // see gallery.test.ts
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const suite = dbUp ? "gallery feed requests against Postgres" : `gallery feed requests against Postgres [skipped: Postgres unreachable at ${dbHost}; run pnpm infra:up]`;

let fx: Awaited<ReturnType<typeof createGalleryFixture>>;

beforeAll(async () => {
  if (dbUp) fx = await createGalleryFixture();
}, 60_000);

afterAll(async () => {
  if (dbUp && fx) await fx.cleanup();
  await prisma.$disconnect();
});

const ctx = (over: { viewer?: Partial<Viewer>; status?: "LIVE" | "DRAFT"; faceSearchEnabled?: boolean; faceSearchAllowed?: boolean } = {}): FeedContext => ({
  event: { id: fx.eventA.id, status: over.status ?? "LIVE", faceSearchEnabled: over.faceSearchEnabled ?? true },
  viewer: fakeViewer(fx.users.viewer.id, over.viewer),
  faceSearchAllowed: over.faceSearchAllowed ?? true,
});

/** A viewer who is the adult guest of the "home" household (which has two children and a deleted one). */
const guardian = (over: { faceSearchOptOut?: boolean } = {}) => ({
  viewer: { guest: { ...fx.guests.adult, household: fx.households.home, ...over } },
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

    it("returns 403 opted_out for 'me' when the adult guest opted out of face search, even with old matches stored", async () => {
      const r = await galleryFeed(ctx(guardian({ faceSearchOptOut: true })), { kind: "me", subject: "me" }, null);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ ok: false, reason: "opted_out" });
      expect(JSON.stringify(r.body)).not.toContain(fx.expectedMainOrder[6]);
    });

    it("pages a child's matches for a guardian in the same household only", async () => {
      await prisma.photoMatch.create({ data: { photoId: fx.expectedMainOrder[9], subjectGuestId: fx.guests.child.id, source: "GUARDIAN", score: 0.8 } });
      const mine = ok(await galleryFeed(ctx(guardian()), { kind: "me", subject: fx.guests.child.id }, null));
      expect(mine.photos.map((p) => p.id)).toEqual([fx.expectedMainOrder[9]]);
    });

    it("returns 403 opted_out for a child who opted out", async () => {
      const r = await galleryFeed(ctx(guardian()), { kind: "me", subject: fx.guests.optedOutChild.id }, null);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ ok: false, reason: "opted_out" });
    });

    it.each([
      ["a child in another household", () => fx.guests.otherHouseholdChild.id],
      ["an adult guest", () => fx.guests.adult.id],
      ["a deleted child", () => fx.guests.deletedChild.id],
      ["an unknown id", () => "nope"],
    ])("404s subject %s", async (_name, subject) => {
      const r = await galleryFeed(ctx(guardian()), { kind: "me", subject: subject() }, null);
      expect(r.status).toBe(404);
    });

    it("404s a child subject for a viewer with no guest row", async () => {
      expect((await galleryFeed(ctx(), { kind: "me", subject: fx.guests.child.id }, null)).status).toBe(404);
    });

    it("is closed when face search is off for the event, not allowed, or the viewer lacks face.search", async () => {
      for (const c of [ctx({ faceSearchEnabled: false }), ctx({ faceSearchAllowed: false }), ctx({ viewer: { can: (a) => a !== "face.search" } })]) {
        const r = await galleryFeed(c, { kind: "me", subject: "me" }, null);
        expect(r.status).toBe(403);
      }
    });
  });

  describe("previousMatchFeeds (first pages for /gallery/me)", () => {
    it("lists the viewer's matches and each searchable child's, never an opted-out child's or another household's", async () => {
      await prisma.photoMatch.createMany({
        data: [
          { photoId: fx.expectedMainOrder[20], userId: fx.users.viewer.id, source: "SELFIE", score: 0.6 },
          { photoId: fx.expectedMainOrder[21], subjectGuestId: fx.guests.child.id, source: "GUARDIAN", score: 0.5 },
          { photoId: fx.expectedMainOrder[22], subjectGuestId: fx.guests.optedOutChild.id, source: "GUARDIAN", score: 0.5 },
          { photoId: fx.expectedMainOrder[23], subjectGuestId: fx.guests.otherHouseholdChild.id, source: "GUARDIAN", score: 0.5 },
        ],
      });
      const r = await previousMatchFeeds(ctx(guardian()));
      expect(r.me.photos.map((p) => p.id)).toContain(fx.expectedMainOrder[20]);
      expect(r.family.map((f) => f.child.id)).toEqual([fx.guests.child.id]);
      const kidIds = r.family[0].page.photos.map((p) => p.id);
      expect(kidIds).toContain(fx.expectedMainOrder[21]);
      expect(kidIds).not.toContain(fx.expectedMainOrder[22]);
      expect(kidIds).not.toContain(fx.expectedMainOrder[23]);
    });

    it("shows no 'Photos of you' for an adult guest who opted out of face search, but still their children's", async () => {
      const r = await previousMatchFeeds(ctx(guardian({ faceSearchOptOut: true })));
      expect(r.me.photos).toEqual([]);
      expect(r.me.nextCursor).toBeNull();
      expect(r.family.map((f) => f.child.id)).toEqual([fx.guests.child.id]);
    });
  });
});
