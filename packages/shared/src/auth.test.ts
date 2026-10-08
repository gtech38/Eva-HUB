import { describe, expect, it } from "vitest";
import { sessionExpiry } from "./auth.ts";

const DAY = 864e5;
const NOW = new Date("2026-10-08T12:00:00Z");
const TTL = { sessionDays: 30, inviteDays: 90 };
const plusDays = (days: number) => new Date(NOW.getTime() + days * DAY);

describe("sessionExpiry", () => {
  it("magic-link sessions last SESSION_TTL_DAYS", () => {
    expect(sessionExpiry("EMAIL_LINK", NOW, TTL)).toEqual(plusDays(30));
    expect(sessionExpiry("SMS_OTP", NOW, TTL)).toEqual(plusDays(30));
  });

  it("invite sessions last INVITE_SESSION_TTL_DAYS when the token outlives it", () => {
    expect(sessionExpiry("INVITE_LINK", NOW, TTL, plusDays(200))).toEqual(plusDays(90));
  });

  it("invite sessions end when the invitation token expires, if that is sooner", () => {
    const tokenExpiresAt = plusDays(12);
    expect(sessionExpiry("INVITE_LINK", NOW, TTL, tokenExpiresAt)).toEqual(tokenExpiresAt);
  });

  it("invite sessions without a known token expiry fall back to INVITE_SESSION_TTL_DAYS", () => {
    expect(sessionExpiry("INVITE_LINK", NOW, TTL)).toEqual(plusDays(90));
  });

  it("token expiry does not cap non-invite sessions", () => {
    expect(sessionExpiry("EMAIL_LINK", NOW, TTL, plusDays(1))).toEqual(plusDays(30));
  });
});
