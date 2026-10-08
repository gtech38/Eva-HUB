import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { OG_FONT_FILES, cmapCoverage, fitToFonts, loadOgFonts, type OgFonts } from "./ogFonts.ts";

const DIR = fileURLToPath(new URL("../../assets/og-fonts/", import.meta.url));
const cp = (s: string) => s.codePointAt(0)!;

let fonts: OgFonts;
beforeAll(async () => {
  fonts = await loadOgFonts(DIR);
});

describe("committed OG fonts", () => {
  it("are Noto Sans (Latin), Noto Sans Telugu and Noto Sans Devanagari, each under 5 MB with its OFL", () => {
    expect(OG_FONT_FILES.map((f) => f.name)).toEqual(["Noto Sans", "Noto Sans Telugu", "Noto Sans Devanagari"]);
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const f of OG_FONT_FILES) {
      expect(statSync(join(DIR, f.file)).size, f.file).toBeLessThan(5 * 1024 * 1024);
      expect(readFileSync(join(DIR, f.licence), "utf8"), f.licence).toMatch(/SIL OPEN FONT LICENSE/i);
      expect(readme, `README lists ${f.file}`).toContain(f.file);
    }
  });

  it("load as static TrueType data in fallback order", () => {
    expect(fonts.fonts.map((f) => f.name)).toEqual(["Noto Sans", "Noto Sans Telugu", "Noto Sans Devanagari"]);
    for (const f of fonts.fonts) expect(f.weight).toBe(400);
  });
});

describe("cmapCoverage", () => {
  it("reads which code points each font has a glyph for", () => {
    const [latin, telugu, devanagari] = OG_FONT_FILES.map((f) => cmapCoverage(readFileSync(join(DIR, f.file))));
    for (const ch of ["A", "&", "ł", "ő", "Ș", "ñ", "·", "—"]) expect(latin(cp(ch)), ch).toBe(true);
    expect(latin(cp("శ"))).toBe(false);
    expect(telugu(cp("శ"))).toBe(true);
    expect(devanagari(cp("न"))).toBe(true);
    expect(devanagari(cp("శ"))).toBe(false);
    for (const cover of [latin, telugu, devanagari]) expect(cover(cp("🎉"))).toBe(false);
  });
});

describe("fitToFonts (nothing uncovered reaches the renderer, so nothing is fetched)", () => {
  const fit = (s: string) => fitToFonts(s, fonts.covers);

  it("keeps Latin, Latin-Ext, Telugu and Devanagari text as-is", () => {
    for (const s of ["Priya & Arjun", "Zoë & Łukasz Ștefan", "ప్రియ & అర్జున్", "प्रिया और अर्जुन", "శ్రీ"]) expect(fit(s)).toBe(s);
  });

  it("drops whole graphemes that no font covers (emoji, ZWJ sequences, other scripts)", () => {
    expect(fit("Priya & Arjun 🎉")).toBe("Priya & Arjun");
    expect(fit("❤️ Emma & Liam")).toBe("Emma & Liam");
    expect(fit("Family 👨‍👩‍👧 day")).toBe("Family day");
    expect(fit("婚礼 Wedding")).toBe("Wedding");
  });

  it("returns an empty string when nothing is renderable", () => {
    expect(fit("🎉🎉")).toBe("");
  });
});
