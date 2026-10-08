import { test } from "node:test";
import assert from "node:assert/strict";
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

test("invite-link session can RSVP and view gallery but never manage", () => {
  const p = base({ authMethod: "INVITE_LINK", guestOf: new Set(["e1"]), eventRoles: { e1: ["HOST"] } });
  assert.equal(can(p, "rsvp.respond", r), true);
  assert.equal(can(p, "gallery.view", r), true);
  assert.equal(can(p, "face.search", r), true);
  assert.equal(can(p, "guests.manage", r), false); // even though they are a HOST
  assert.equal(can(p, "photos.hide", r), false);
});

test("stale elevated session is rejected", () => {
  const p = base({ eventRoles: { e1: ["HOST"] }, authedAt: new Date(Date.now() - 13 * 36e5) });
  assert.equal(can(p, "guests.manage", r), false);
  assert.equal(can(p, "rsvp.respond", r), true); // non-elevated still fine
});

test("studio owner can do studio and event admin; guest cannot", () => {
  const owner = base({ studioRoles: { s1: "OWNER" } });
  assert.equal(can(owner, "event.create", r), true);
  assert.equal(can(owner, "photos.upload", r), true);
  assert.equal(can(owner, "entitlements.grant", r), true);
  assert.equal(can(owner, "face.search", r), false); // staff don't selfie-search

  const guest = base({ guestOf: new Set(["e1"]) });
  assert.equal(can(guest, "event.create", r), false);
  assert.equal(can(guest, "photos.upload", r), false);
  assert.equal(can(guest, "gallery.view", r), true);
  assert.equal(can(guest, "gallery.view.hostsOnly", r), false);
});

test("staff only upload to assigned events", () => {
  const staff = base({ studioRoles: { s1: "STAFF" } });
  assert.equal(can(staff, "photos.upload", r), false);
  const assigned = base({ studioRoles: { s1: "STAFF" }, eventRoles: { e1: ["STAFF"] } });
  assert.equal(can(assigned, "photos.upload", r), true);
  assert.equal(can(assigned, "studio.manage", r), false);
});

test("tenant isolation: roles in another studio grant nothing", () => {
  const other = base({ studioRoles: { s2: "OWNER" }, eventRoles: { e2: ["HOST"] } });
  assert.equal(can(other, "site.view", r), false);
  assert.equal(can(other, "gallery.view", r), false);
});

test("platform admin bypasses everything except invite-link rule", () => {
  const admin = base({ isPlatformAdmin: true });
  assert.equal(can(admin, "platform.admin", r), true);
  assert.equal(can(admin, "studio.manage", { studioId: "s9" }), true);
  const adminViaInvite = base({ isPlatformAdmin: true, authMethod: "INVITE_LINK" });
  assert.equal(can(adminViaInvite, "studio.manage", r), false);
});
