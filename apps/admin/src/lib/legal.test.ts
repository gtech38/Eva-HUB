import { describe, expect, it } from "vitest";
import { CONSENT_TEXT_VERSION, consentText } from "@hub/shared/consent";
import { consentCatalog } from "./legal";

describe("consentCatalog (/platform/legal)", () => {
  it("lists every consent kind with the stored version and its text in en, te and hi", () => {
    const catalog = consentCatalog();
    expect(catalog.version).toBe(CONSENT_TEXT_VERSION);
    expect(catalog.kinds.map((k) => [k.kind, k.recordVersion])).toStrictEqual([
      ["SEARCH_SELF", "SEARCH_SELF:v1-2026-10"],
      ["SEARCH_GUARDIAN", "SEARCH_GUARDIAN:v1-2026-10"],
      ["FACE_PROFILE", "FACE_PROFILE:v1-2026-10"],
    ]);
    for (const k of catalog.kinds) {
      expect(k.texts.map((d) => d.locale)).toStrictEqual(["en", "te", "hi"]);
      expect(k.texts[1]).toStrictEqual(consentText(k.kind, "te"));
    }
  });

  it("flags that v1 is a draft pending attorney review and not yet reviewed", () => {
    const { kinds } = consentCatalog();
    const all = kinds.flatMap((k) => k.texts);
    expect(all.every((d) => d.status.startsWith("DRAFT") && d.reviewedBy === "")).toBe(true);
    expect(all.filter((d) => d.translation !== "").map((d) => d.locale).sort()).toStrictEqual(["hi", "hi", "hi", "te", "te", "te"]);
  });
});
