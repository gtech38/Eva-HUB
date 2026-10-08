import { describe, expect, it } from "vitest";
import { inviteNotice, INVITE_EXPIRED_PATH } from "./inviteNotice";

describe("inviteNotice", () => {
  it("the expired-link URL carries the flag the sign-in form reads", () => {
    const params = new URL(INVITE_EXPIRED_PATH, "http://x.localhost").searchParams;
    expect(inviteNotice(params, "en")).toBe("This link has expired");
  });

  it("is localised", () => {
    const en = inviteNotice(new URLSearchParams("invite=expired"), "en");
    expect(inviteNotice(new URLSearchParams("invite=expired"), "te")).not.toBe(en);
    expect(inviteNotice(new URLSearchParams("invite=expired"), "hi")).not.toBe(en);
  });

  it("is null for an ordinary visit", () => {
    expect(inviteNotice(new URLSearchParams(""), "en")).toBeNull();
    expect(inviteNotice(new URLSearchParams("invite=other"), "en")).toBeNull();
    expect(inviteNotice(null, "en")).toBeNull();
  });
});
