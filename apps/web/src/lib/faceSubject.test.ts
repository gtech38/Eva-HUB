/**
 * Who a viewer may run (or read) a face search for: themselves, or a child in their own
 * household. One rule shared by POST /api/face/search, GET /api/gallery/me and /gallery/me.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { createGalleryFixture, dbReachable, failInCiWithoutPostgres } from "../../test/galleryFixture";
import { listSearchableChildren, resolveFaceSubject } from "./faceSubject";
import type { Viewer } from "./site";

const dbUp = await dbReachable();
failInCiWithoutPostgres("face subject rules against Postgres", dbUp);
const suite = dbUp ? "face subject rules against Postgres" : "face subject rules against Postgres [skipped: Postgres unreachable; run pnpm infra:up]";

let fx: Awaited<ReturnType<typeof createGalleryFixture>>;
beforeAll(async () => {
  if (dbUp) fx = await createGalleryFixture();
}, 60_000);
afterAll(async () => {
  if (dbUp && fx) await fx.cleanup();
  await prisma.$disconnect();
});

type Guardian = Pick<Viewer, "guest">;
const guardian = (over: { faceSearchOptOut?: boolean } = {}): Guardian => ({
  guest: { ...fx.guests.adult, household: fx.households.home, ...over },
});
const noGuest: Guardian = { guest: null };

describe.skipIf(!dbUp)(suite, () => {
  describe("resolveFaceSubject", () => {
    it.each([null, "me"])("subject %j is the viewer themself, with or without a guest row", async (subject) => {
      expect(await resolveFaceSubject(noGuest, fx.eventA.id, subject)).toEqual({ ok: true, subject: { kind: "me" } });
      expect(await resolveFaceSubject(guardian(), fx.eventA.id, subject)).toEqual({ ok: true, subject: { kind: "me" } });
    });

    it("refuses 'me' with opted_out when the viewer's own guest row opted out of face search", async () => {
      expect(await resolveFaceSubject(guardian({ faceSearchOptOut: true }), fx.eventA.id, "me")).toEqual({ ok: false, reason: "opted_out" });
    });

    it("accepts a child in the viewer's household", async () => {
      expect(await resolveFaceSubject(guardian(), fx.eventA.id, fx.guests.child.id)).toEqual({ ok: true, subject: { kind: "child", guestId: fx.guests.child.id } });
    });

    it("refuses a child who opted out with opted_out", async () => {
      expect(await resolveFaceSubject(guardian(), fx.eventA.id, fx.guests.optedOutChild.id)).toEqual({ ok: false, reason: "opted_out" });
    });

    it.each([
      ["a child in another household", () => fx.guests.otherHouseholdChild.id],
      ["an adult guest", () => fx.guests.adult.id],
      ["a deleted child", () => fx.guests.deletedChild.id],
      ["an unknown id", () => "no-such-guest"],
    ])("refuses %s with forbidden", async (_name, subject) => {
      expect(await resolveFaceSubject(guardian(), fx.eventA.id, subject())).toEqual({ ok: false, reason: "forbidden" });
    });

    it("refuses a child subject for a viewer with no guest row", async () => {
      expect(await resolveFaceSubject(noGuest, fx.eventA.id, fx.guests.child.id)).toEqual({ ok: false, reason: "forbidden" });
    });

    it("is scoped to the event: the same child id under another event is forbidden", async () => {
      expect(await resolveFaceSubject(guardian(), fx.eventB.id, fx.guests.child.id)).toEqual({ ok: false, reason: "forbidden" });
    });
  });

  describe("listSearchableChildren", () => {
    it("lists the household's live children who have not opted out, and nobody else's", async () => {
      const kids = await listSearchableChildren(guardian(), fx.eventA.id);
      expect(kids.map((k) => k.id)).toEqual([fx.guests.child.id]);
    });

    it("is empty for a viewer with no guest row", async () => {
      expect(await listSearchableChildren(noGuest, fx.eventA.id)).toEqual([]);
    });
  });
});
