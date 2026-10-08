import { describe, expect, it } from "vitest";
import { LOCALES } from "@hub/shared/i18n";
import { consentBlocks, consentText } from "@hub/shared/consent";
import { consentTextsFor } from "./consentView";

describe("consentTextsFor", () => {
  it("gives the face-search UI the full text of all three kinds in every locale", () => {
    for (const locale of LOCALES) {
      const v = consentTextsFor(locale);
      expect(v.self.blocks).toStrictEqual(consentBlocks(consentText("SEARCH_SELF", locale).body));
      expect(v.guardian.blocks).toStrictEqual(consentBlocks(consentText("SEARCH_GUARDIAN", locale).body));
      expect(v.profile.blocks).toStrictEqual(consentBlocks(consentText("FACE_PROFILE", locale).body));
    }
  });

  it("labels each text with the exact value the search route stores", () => {
    const v = consentTextsFor("te");
    expect([v.self.version, v.guardian.version, v.profile.version]).toStrictEqual([
      "SEARCH_SELF:v1-2026-10",
      "SEARCH_GUARDIAN:v1-2026-10",
      "FACE_PROFILE:v1-2026-10",
    ]);
  });

  it("renders Telugu text for te (not an English fallback)", () => {
    const first = consentTextsFor("te").self.blocks[0];
    expect(first.type).toBe("heading");
    expect(first.type === "heading" && /[ఀ-౿]/.test(first.text)).toBe(true);
  });
});
