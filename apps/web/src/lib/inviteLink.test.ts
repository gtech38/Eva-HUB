import { describe, expect, it } from "vitest";
import { inviteUsable } from "./inviteLink";

const NOW = new Date("2027-06-01T12:00:00Z");
const later = new Date("2027-06-02T00:00:00Z");
const earlier = new Date("2027-05-31T00:00:00Z");
const invite = (o: Partial<{ revokedAt: Date | null; expiresAt: Date; eventId: string; deletedAt: Date | null }> = {}) => ({
  revokedAt: o.revokedAt ?? null,
  expiresAt: o.expiresAt ?? later,
  guest: { eventId: o.eventId ?? "ev1", deletedAt: o.deletedAt ?? null },
});

describe("inviteUsable", () => {
  it("accepts a live token for this event's guest", () => {
    expect(inviteUsable(invite(), "ev1", NOW)).toBe(true);
  });

  it("rejects an expired token", () => {
    expect(inviteUsable(invite({ expiresAt: earlier }), "ev1", NOW)).toBe(false);
  });

  it("rejects a token at the exact instant it expires", () => {
    expect(inviteUsable(invite({ expiresAt: NOW }), "ev1", NOW)).toBe(false);
    expect(inviteUsable(invite({ expiresAt: new Date(NOW.getTime() + 1) }), "ev1", NOW)).toBe(true);
  });

  it("rejects a revoked token", () => {
    expect(inviteUsable(invite({ revokedAt: earlier }), "ev1", NOW)).toBe(false);
  });

  it("rejects an unknown token, another event's token and a removed guest's token", () => {
    expect(inviteUsable(null, "ev1", NOW)).toBe(false);
    expect(inviteUsable(invite({ eventId: "ev2" }), "ev1", NOW)).toBe(false);
    expect(inviteUsable(invite({ deletedAt: earlier }), "ev1", NOW)).toBe(false);
  });
});
