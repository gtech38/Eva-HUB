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

  it("registry.claim: only a guest of the event, including via an invitation link (docs/02 section 4)", () => {
    const guest = base({ guestOf: new Set(["e1"]) });
    expect(can(guest, "registry.claim", r)).toBe(true);
    expect(can(base({ authMethod: "INVITE_LINK", guestOf: new Set(["e1"]) }), "registry.claim", r)).toBe(true);
    expect(can(guest, "registry.claim", { studioId: "s1", eventId: "e2" })).toBe(false);
    expect(can(base({ eventRoles: { e1: ["HOST"] } }), "registry.claim", r)).toBe(false);
    expect(can(base({ studioRoles: { s1: "OWNER" } }), "registry.claim", r)).toBe(false);
    expect(can(base({ eventRoles: { e1: ["VENDOR"] } }), "registry.claim", r)).toBe(false);
  });

  it("registry.claim: a platform admin who is not a guest of the event is refused (docs/02 section 4: guests only)", () => {
    expect(can(base({ isPlatformAdmin: true }), "registry.claim", r)).toBe(false);
    expect(can(base({ isPlatformAdmin: true, guestOf: new Set(["e2"]) }), "registry.claim", r)).toBe(false);
    expect(can(base({ isPlatformAdmin: true, guestOf: new Set(["e1"]) }), "registry.claim", r)).toBe(true);
    // No event in scope: nothing to claim against.
    expect(can(base({ isPlatformAdmin: true, guestOf: new Set(["e1"]) }), "registry.claim", { studioId: "s1" })).toBe(false);
  });

  it("tenant isolation: roles in another studio grant nothing", () => {
    const other = base({ studioRoles: { s2: "OWNER" }, eventRoles: { e2: ["HOST"] } });
    expect(can(other, "site.view", r)).toBe(false);
    expect(can(other, "gallery.view", r)).toBe(false);
  });

  it("vendor sees RSVP meal counts but not guest names (rsvp.report.names)", () => {
    const vendor = base({ eventRoles: { e1: ["VENDOR"] } });
    expect(can(vendor, "rsvp.report", r)).toBe(true);
    expect(can(vendor, "rsvp.report.names", r)).toBe(false);
    for (const role of ["HOST", "COHOST", "PLANNER"] as const) {
      expect(can(base({ eventRoles: { e1: [role] } }), "rsvp.report.names", r)).toBe(true);
    }
    expect(can(base({ studioRoles: { s1: "OWNER" } }), "rsvp.report.names", r)).toBe(true);
    // Studio staff see names only on events they are assigned to; otherwise counts only.
    const unassigned = base({ studioRoles: { s1: "STAFF" } });
    expect(can(unassigned, "rsvp.report", r)).toBe(true);
    expect(can(unassigned, "rsvp.report.names", r)).toBe(false);
    expect(can(base({ studioRoles: { s1: "STAFF" }, eventRoles: { e1: ["STAFF"] } }), "rsvp.report.names", r)).toBe(true);
    expect(can(base({ studioRoles: { s1: "STAFF" }, eventRoles: { e2: ["STAFF"] } }), "rsvp.report.names", r)).toBe(false);
    // A vendor who is also a planner gets names through the planner role.
    expect(can(base({ eventRoles: { e1: ["VENDOR", "PLANNER"] } }), "rsvp.report.names", r)).toBe(true);
    // Elevated: forwarded invite links and other studios never see names.
    expect(can(base({ authMethod: "INVITE_LINK", eventRoles: { e1: ["HOST"] } }), "rsvp.report.names", r)).toBe(false);
    expect(can(base({ studioRoles: { s2: "OWNER" } }), "rsvp.report.names", r)).toBe(false);
    expect(can(base({ guestOf: new Set(["e1"]) }), "rsvp.report.names", r)).toBe(false);
  });

  it("platform admin bypasses everything except invite-link rule", () => {
    const admin = base({ isPlatformAdmin: true });
    expect(can(admin, "platform.admin", r)).toBe(true);
    expect(can(admin, "studio.manage", { studioId: "s9" })).toBe(true);
    const adminViaInvite = base({ isPlatformAdmin: true, authMethod: "INVITE_LINK" });
    expect(can(adminViaInvite, "studio.manage", r)).toBe(false);
  });
});
