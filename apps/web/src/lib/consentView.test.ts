import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { consentFor, type ConsentTexts, type ConsentView } from "./consentView";

const v = (label: string): ConsentView => ({ label, summary: "", blocks: [], version: `X:${label}`, locale: "en" });
const texts: ConsentTexts = { self: v("self"), guardian: v("guardian"), profile: v("profile") };

describe("consentFor", () => {
  it("searching for yourself shows the self text", () => {
    expect(consentFor("me", texts)).toBe(texts.self);
  });

  it("searching for a child guest shows the guardian text", () => {
    expect(consentFor("guest-child-id", texts)).toBe(texts.guardian);
  });

  it("is client-safe: imports nothing from @hub/shared/consent at runtime", () => {
    const src = readFileSync(fileURLToPath(new URL("./consentView.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/^import (?!type )[^;]*@hub\/shared\/consent/m);
  });
});
