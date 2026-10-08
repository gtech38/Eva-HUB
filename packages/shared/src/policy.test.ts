import { describe, expect, it } from "vitest";
import { can, type Principal } from "./policy.ts";

const base = (over: Partial<Principal> = {}): Principal => ({
  userId: "u1",
  isPlatformAdmin: false,
  studioRoles: {},
  eventRoles: {},
  guestOf: new Set(),
  authMethod: "EMAIL_LINK",
  authedAt: new Date(),
  ...over,
});
const r = { studioId: "s1", eventId: "e1" };

describe("can()", () => {
  it("invite-link session can RSVP and view gallery but never manage", () => {
    const p = base({ authMethod: "INVITE_LINK", guestOf: new Set(["e1"]), eventRoles: { e1: ["HOST"] } });
    expect(can(p, "rsvp.respond", r)).toBe(true);
    expect(can(p, "gallery.view", r)).toBe(true);
    expect(can(p, "face.search", r)).toBe(true);
    expect(can(p, "guests.manage", r)).toBe(false); // even though they are a HOST
    expect(can(p, "photos.hide", r)).toBe(false);
  });

  it("stale elevated session is rejected", () => {
    const p = base({ eventRoles: { e1: ["HOST"] }, authedAt: new Date(Date.now() - 13 * 36e5) });
    expect(can(p, "guests.manage", r)).toBe(false);
    expect(can(p, "rsvp.respond", r)).toBe(true); // non-elevated still fine
  });

  it("studio owner can do studio and event admin; guest cannot", () => {
    const owner = base({ studioRoles: { s1: "OWNER" } });
    expect(can(owner, "event.create", r)).toBe(true);
    expect(can(owner, "photos.upload", r)).toBe(true);
    expect(can(owner, "entitlements.grant", r)).toBe(true);
    expect(can(owner, "face.search", r)).toBe(false); // staff don't selfie-search

    const guest = base({ guestOf: new Set(["e1"]) });
    expect(can(guest, "event.create", r)).toBe(false);
    expect(can(guest, "photos.upload", r)).toBe(false);
    expect(can(guest, "gallery.view", r)).toBe(true);
    expect(can(guest, "gallery.view.hostsOnly", r)).toBe(false);
  });

  it("staff only upload to assigned events", () => {
    const staff = base({ studioRoles: { s1: "STAFF" } });
    expect(can(staff, "photos.upload", r)).toBe(false);
    const assigned = base({ studioRoles: { s1: "STAFF" }, eventRoles: { e1: ["STAFF"] } });
    expect(can(assigned, "photos.upload", r)).toBe(true);
    expect(can(assigned, "studio.manage", r)).toBe(false);
  });

  it("tenant isolation: roles in another studio grant nothing", () => {
    const other = base({ studioRoles: { s2: "OWNER" }, eventRoles: { e2: ["HOST"] } });
    expect(can(other, "site.view", r)).toBe(false);
    expect(can(other, "gallery.view", r)).toBe(false);
  });

  it("platform admin bypasses everything except invite-link rule", () => {
    const admin = base({ isPlatformAdmin: true });
    expect(can(admin, "platform.admin", r)).toBe(true);
    expect(can(admin, "studio.manage", { studioId: "s9" })).toBe(true);
    const adminViaInvite = base({ isPlatformAdmin: true, authMethod: "INVITE_LINK" });
    expect(can(adminViaInvite, "studio.manage", r)).toBe(false);
  });
});
