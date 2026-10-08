import { describe, expect, it } from "vitest";
import { LOCALES } from "@hub/shared/i18n";
import { consentBlocks, consentText } from "@hub/shared/consent";
import { consentTextsFor } from "./consentTexts";

describe("consentTextsFor", () => {
  it("gives the face-search UI the label, summary and full text of all three kinds in every locale", () => {
    for (const locale of LOCALES) {
      const v = consentTextsFor(locale);
      for (const [view, kind] of [
        [v.self, "SEARCH_SELF"],
        [v.guardian, "SEARCH_GUARDIAN"],
        [v.profile, "FACE_PROFILE"],
      ] as const) {
        const doc = consentText(kind, locale);
        expect(view.blocks).toStrictEqual(consentBlocks(doc.body));
        expect(view.label).toBe(doc.label);
        expect(view.summary).toBe(doc.summary);
        expect(view.locale).toBe(locale);
      }
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
    const v = consentTextsFor("te").self;
    expect(/[ఀ-౿]/.test(v.label)).toBe(true);
    const first = v.blocks[0];
    expect(first.type === "heading" && /[ఀ-౿]/.test(first.text)).toBe(true);
  });
});
