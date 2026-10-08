import { describe, expect, it } from "vitest";
import { LOCALES, UI, ui } from "./i18n.ts";

describe("UI strings", () => {
  it("every UI string is translated into every locale", () => {
    for (const [key, text] of Object.entries(UI)) {
      for (const l of LOCALES) expect((text as Record<string, string>)[l], `${key}.${l}`).toBeTruthy();
    }
  });

  it("has the registry and wedding party strings (WEB-009)", () => {
    expect(ui("party", "en")).toBe("Wedding Party");
    expect(ui("youPurchased", "en")).toBe("You purchased this");
    expect(ui("markPurchased", "en")).toBe("Mark as purchased");
    expect(ui("comingSoon", "en")).toBe("Coming soon");
    for (const key of ["party", "markPurchased", "youPurchased", "undo", "contribute", "comingSoon", "copy", "copied"] as const) {
      // Telugu and Hindi must differ from English (a copy-pasted English string is untranslated).
      expect(ui(key, "te"), `${key}.te`).not.toBe(ui(key, "en"));
      expect(ui(key, "hi"), `${key}.hi`).not.toBe(ui(key, "en"));
    }
  });

  it("has the expired-invitation heading (ADM-005)", () => {
    expect(ui("inviteExpired", "en")).toBe("This link has expired");
  });

  it("has the neutral too-many-requests sentence (SHR-003)", () => {
    expect(ui("tooManyRequests", "en")).toBe("Too many requests. Please wait a few minutes and try again.");
  });
});
