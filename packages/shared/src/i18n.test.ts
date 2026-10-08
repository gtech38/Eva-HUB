import { describe, expect, it } from "vitest";
import { LOCALES, UI, ui } from "./i18n.ts";

describe("UI strings", () => {
  it("every UI string is translated into every locale", () => {
    for (const [key, text] of Object.entries(UI)) {
      for (const l of LOCALES) expect((text as Record<string, string>)[l], `${key}.${l}`).toBeTruthy();
    }
  });

  it("has the expired-invitation heading and help (ADM-005)", () => {
    expect(ui("inviteExpired", "en")).toBe("This link has expired");
    expect(ui("inviteExpiredHelp", "en")).toBe("Enter your email or phone and we'll send you a new one.");
  });
});
