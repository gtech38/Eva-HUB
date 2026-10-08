import { describe, expect, it } from "vitest";
import { createSession, sessionExpiry } from "./auth.ts";

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

  it("an invite session minted 1 ms before the token expires is still in the future at `now`", () => {
    const tokenExpiresAt = new Date(NOW.getTime() + 1);
    expect(sessionExpiry("INVITE_LINK", NOW, TTL, tokenExpiresAt).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("createSession types", () => {
  it("INVITE_LINK requires the event scope and the token expiry at compile time", () => {
    // Never called: `pnpm typecheck` fails if any @ts-expect-error below stops being an error.
    const typeOnly = () => {
      // @ts-expect-error INVITE_LINK without options
      void createSession("u", "INVITE_LINK");
      // @ts-expect-error INVITE_LINK without inviteExpiresAt
      void createSession("u", "INVITE_LINK", { guestScopeEventId: "e" });
      // @ts-expect-error INVITE_LINK without guestScopeEventId
      void createSession("u", "INVITE_LINK", { inviteExpiresAt: NOW });
      // @ts-expect-error sessionExpiry for INVITE_LINK without the token expiry
      void sessionExpiry("INVITE_LINK", NOW, TTL);
      void createSession("u", "INVITE_LINK", { guestScopeEventId: "e", inviteExpiresAt: NOW, now: NOW });
      void createSession("u", "EMAIL_LINK");
      void createSession("u", "EMAIL_LINK", { now: NOW });
    };
    expect(typeof typeOnly).toBe("function");
  });
});
