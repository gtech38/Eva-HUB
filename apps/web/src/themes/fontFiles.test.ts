/**
 * WEB-012: the vendored WOFF2 files themselves. fonts.test.ts checks how fonts.ts refers to them;
 * this checks what is in them (size budget, licence, name table, glyph coverage) and that the
 * documented rebuild script keeps its reproducibility pins.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasGlyph, nameIds, parseWoff2 } from "../../test/woff2";

const themesDir = dirname(fileURLToPath(import.meta.url));
const filesDir = join(themesDir, "font-files");

/** Total payload budget from the WEB-012 ticket, in bytes. */
const BUDGET_BYTES = 1_200_000;

/** Families whose OFL.txt declares a Reserved Font Name; such fonts must not be modified (OFL s.3). */
const RFN_ALLOWLIST = ["marcellus"];

/** Latin families that carry latin-ext (every Latin family except Inter, which is the size exception). */
const LATIN_EXT_FAMILIES = [
  "instrument-serif",
  "luxurious-script",
  "inria-serif",
  "cinzel",
  "pinyon-script",
  "cormorant-garamond",
  "marcellus",
  "bodoni-moda",
  "manrope",
  "jetbrains-mono",
];

/** Families whose source font has the arrows U+2190-2193 (the others cannot show them). */
const ARROW_FAMILIES = ["cormorant-garamond", "inria-serif", "inter", "jetbrains-mono", "manrope"];

const families = readdirSync(filesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const woff2Of = (family: string) =>
  readdirSync(join(filesDir, family))
    .filter((n) => n.endsWith(".woff2"))
    .map((n) => join(filesDir, family, n));

const allWoff2 = families.flatMap(woff2Of);

describe("font-files: payload", () => {
  it("covers all 15 families", () => {
    expect(families).toHaveLength(15);
  });

  it("stays within the 1.2 MB budget", () => {
    const total = allWoff2.reduce((sum, f) => sum + statSync(f).size, 0);
    expect(total, `total ${total} bytes`).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("keeps every file well under the 5 MB commit limit", () => {
    for (const f of allWoff2) expect(statSync(f).size, f).toBeLessThan(5_000_000);
  });
});

describe("font-files: licences", () => {
  it.each(families)("%s ships the full SIL OFL 1.1 text", (family) => {
    const path = join(filesDir, family, "OFL.txt");
    expect(existsSync(path), path).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/Copyright/);
    expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    expect(text).toMatch(/PERMISSION & CONDITIONS/);
  });

  it("only allow-listed families declare a Reserved Font Name", () => {
    const withRfn = families.filter((family) =>
      /with Reserved Font Names?/i.test(readFileSync(join(filesDir, family, "OFL.txt"), "utf8")),
    );
    expect(withRfn).toEqual(RFN_ALLOWLIST);
  });

  it("keeps licence name IDs 13 and 14 in every file", () => {
    for (const f of allWoff2) {
      const ids = nameIds(parseWoff2(readFileSync(f)));
      expect(ids.has(13), `${f} nameID 13`).toBe(true);
      expect(ids.has(14), `${f} nameID 14`).toBe(true);
    }
  });
});

describe("font-files: glyph coverage", () => {
  it("reads the Indic fonts as their own script", () => {
    const telugu = parseWoff2(readFileSync(join(filesDir, "noto-sans-telugu", "NotoSansTelugu-VF.woff2")));
    const devanagari = parseWoff2(readFileSync(join(filesDir, "noto-sans-devanagari", "NotoSansDevanagari-VF.woff2")));
    expect(hasGlyph(telugu, 0x0c15)).toBe(true);
    expect(hasGlyph(devanagari, 0x0915)).toBe(true);
    expect(hasGlyph(telugu, 0x0041)).toBe(false);
  });

  it.each(LATIN_EXT_FAMILIES)("%s includes latin-ext (U+0141 and U+0151)", (family) => {
    for (const f of woff2Of(family)) {
      const font = parseWoff2(readFileSync(f));
      expect(hasGlyph(font, 0x0041), `${f} basic latin`).toBe(true);
      expect(hasGlyph(font, 0x0141), `${f} U+0141`).toBe(true);
      expect(hasGlyph(font, 0x0151), `${f} U+0151`).toBe(true);
    }
  });

  it("leaves latin-ext out of Inter (documented size exception)", () => {
    const inter = parseWoff2(readFileSync(join(filesDir, "inter", "Inter-VF.woff2")));
    expect(hasGlyph(inter, 0x0041)).toBe(true);
    expect(hasGlyph(inter, 0x0141)).toBe(false);
  });

  it.each(ARROW_FAMILIES)("%s includes the arrows U+2190-2193", (family) => {
    for (const f of woff2Of(family)) {
      const font = parseWoff2(readFileSync(f));
      for (const cp of [0x2190, 0x2191, 0x2192, 0x2193]) expect(hasGlyph(font, cp), `${f} U+${cp.toString(16)}`).toBe(true);
    }
  });
});

describe("font-files/build.sh (rebuild recipe)", () => {
  const scriptPath = join(filesDir, "build.sh");

  it("exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";

  it("pins fonttools and brotli", () => {
    expect(script).toMatch(/fonttools==4\.66\.1/);
    expect(script).toMatch(/brotli==1\.2\.0/);
  });

  it("builds deterministically", () => {
    expect(script).toMatch(/--no-harfbuzz-repacker/);
    expect(script).toMatch(/SOURCE_DATE_EPOCH=/);
  });

  it("keeps the licence name IDs when subsetting", () => {
    expect(script).toMatch(/--name-IDs=0,1,2,3,4,5,6,13,14\b/);
  });

  it("subsets with the arrows and latin-ext ranges, but not for Inter", () => {
    expect(script).toMatch(/U\+2190-2193/);
    expect(script).toMatch(/LATIN_EXT=/);
    expect(script).toMatch(/build inter .*"\$LATIN"/);
  });
});
