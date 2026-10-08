import { describe, expect, it } from "vitest";
import { checkInvite, inviteNotice, INVITE_EXPIRED_PATH } from "./inviteLink";

const NOW = new Date("2027-06-01T12:00:00Z");
const later = new Date("2027-06-02T00:00:00Z");
const earlier = new Date("2027-05-31T00:00:00Z");
const invite = (o: Partial<{ revokedAt: Date | null; expiresAt: Date; eventId: string; deletedAt: Date | null }> = {}) => ({
  revokedAt: o.revokedAt ?? null,
  expiresAt: o.expiresAt ?? later,
  guest: { eventId: o.eventId ?? "ev1", deletedAt: o.deletedAt ?? null },
});

describe("checkInvite", () => {
  it("accepts a live token for this event's guest", () => {
    expect(checkInvite(invite(), "ev1", NOW)).toBe("ok");
  });

  it("an expired token is 'expired'", () => {
    expect(checkInvite(invite({ expiresAt: earlier }), "ev1", NOW)).toBe("expired");
  });

  it("a revoked token is 'expired' (resend rotated it)", () => {
    expect(checkInvite(invite({ revokedAt: earlier }), "ev1", NOW)).toBe("expired");
  });

  it("an unknown token, another event's token or a removed guest is 'invalid'", () => {
    expect(checkInvite(null, "ev1", NOW)).toBe("invalid");
    expect(checkInvite(invite({ eventId: "ev2" }), "ev1", NOW)).toBe("invalid");
    expect(checkInvite(invite({ deletedAt: earlier }), "ev1", NOW)).toBe("invalid");
  });
});

describe("inviteNotice", () => {
  it("the expired-link URL carries the flag the sign-in form reads", () => {
    const params = new URL(INVITE_EXPIRED_PATH, "http://x.localhost").searchParams;
    expect(inviteNotice(params, "en")).not.toBeNull();
  });

  it("explains the expiry and asks for an email or phone", () => {
    const n = inviteNotice(new URLSearchParams("invite=expired"), "en")!;
    expect(n.heading).toMatch(/expired/i);
    expect(n.help).toMatch(/email or phone/i);
  });

  it("is localised", () => {
    const en = inviteNotice(new URLSearchParams("invite=expired"), "en")!;
    const te = inviteNotice(new URLSearchParams("invite=expired"), "te")!;
    const hi = inviteNotice(new URLSearchParams("invite=expired"), "hi")!;
    expect(te.heading).not.toBe(en.heading);
    expect(hi.heading).not.toBe(en.heading);
  });

  it("is null for an ordinary visit", () => {
    expect(inviteNotice(new URLSearchParams(""), "en")).toBeNull();
    expect(inviteNotice(new URLSearchParams("invite=other"), "en")).toBeNull();
    expect(inviteNotice(null, "en")).toBeNull();
  });
});
