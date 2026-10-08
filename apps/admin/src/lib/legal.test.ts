import { describe, expect, it } from "vitest";
import { CONSENT_VERSIONS, CURRENT_CONSENT_VERSION, consentBlocks, consentText } from "@hub/shared/consent";
import { consentCatalog } from "./legal";

describe("consentCatalog (/platform/legal)", () => {
  it("lists every bundled version, newest first, marking the current one", () => {
    const catalog = consentCatalog();
    expect(catalog.map((v) => v.version)).toStrictEqual(CONSENT_VERSIONS.map((v) => v.version).reverse());
    expect(catalog.filter((v) => v.current).map((v) => v.version)).toStrictEqual([CURRENT_CONSENT_VERSION]);
  });

  it("each version lists every consent kind with the stored KIND:version and its text in en, te and hi", () => {
    const v1 = consentCatalog().find((v) => v.version === "v1-2026-10")!;
    expect(v1.dir).toBe("v1");
    expect(v1.kinds.map((k) => [k.kind, k.recordVersion])).toStrictEqual([
      ["SEARCH_SELF", "SEARCH_SELF:v1-2026-10"],
      ["SEARCH_GUARDIAN", "SEARCH_GUARDIAN:v1-2026-10"],
      ["FACE_PROFILE", "FACE_PROFILE:v1-2026-10"],
    ]);
    for (const k of v1.kinds) {
      expect(k.texts.map((t) => t.doc.locale)).toStrictEqual(["en", "te", "hi"]);
      const te = consentText(k.kind, "te", "v1-2026-10");
      expect(k.texts[1].doc).toStrictEqual(te);
      // Rendered the way guests see it: blocks, not raw markdown.
      expect(k.texts[1].blocks).toStrictEqual(consentBlocks(te.body));
    }
  });

  it("flags that v1 is a draft pending attorney review and not yet reviewed", () => {
    const docs = consentCatalog().find((v) => v.version === "v1-2026-10")!.kinds.flatMap((k) => k.texts.map((t) => t.doc));
    expect(docs.every((d) => d.status.startsWith("DRAFT") && d.reviewedBy === "")).toBe(true);
    expect(docs.filter((d) => d.translation !== "").map((d) => d.locale).sort()).toStrictEqual(["hi", "hi", "hi", "te", "te", "te"]);
  });
});
