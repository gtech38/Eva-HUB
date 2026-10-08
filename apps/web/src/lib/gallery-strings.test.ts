import { describe, expect, it } from "vitest";
import { LOCALES } from "@hub/shared/i18n";
import { galleryStrings } from "./gallery-strings";

const PAGING = ["loadingMore", "loadFailed", "retry"] as const;

describe("galleryStrings", () => {
  it("provides every string in every locale, none empty", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(galleryStrings(locale))) {
        expect(value, `${locale}.${key}`).toBeTypeOf("string");
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("translates the paging strings instead of falling back to English", () => {
    const en = galleryStrings("en");
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const s = galleryStrings(locale);
      for (const key of PAGING) expect(s[key], `${locale}.${key}`).not.toBe(en[key]);
    }
  });
});
