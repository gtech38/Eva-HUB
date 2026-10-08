/**
 * Fonts for the /og.png renderer, read from committed files (assets/og-fonts) so rendering
 * never touches the network. `fitToFonts` removes any grapheme none of them can draw, so
 * the renderer is never asked to find a glyph elsewhere.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_FONT_FILES = [
  { name: "Noto Sans", file: "NotoSans-Regular.ttf", licence: "OFL-NotoSans.txt" },
  { name: "Noto Sans Telugu", file: "NotoSansTelugu-Regular.ttf", licence: "OFL-NotoSansTelugu.txt" },
  { name: "Noto Sans Devanagari", file: "NotoSansDevanagari-Regular.ttf", licence: "OFL-NotoSansDevanagari.txt" },
] as const;

export type OgFont = { name: string; data: Buffer; weight: 400; style: "normal" };
export type Covers = (codePoint: number) => boolean;
/** `fonts` for satori, `covers` for fitToFonts. */
export type OgFonts = { fonts: OgFont[]; covers: Covers };

export async function loadOgFonts(dir: string): Promise<OgFonts> {
  const fonts = await Promise.all(
    OG_FONT_FILES.map(async (f) => ({ name: f.name, data: await readFile(join(dir, f.file)), weight: 400 as const, style: "normal" as const })),
  );
  const each = fonts.map((f) => cmapCoverage(f.data));
  return { fonts, covers: (c) => each.some((cover) => cover(c)) };
}

type Range = [start: number, end: number];

/** Which code points a TrueType/OpenType font maps to a real glyph (cmap format 12 or 4). */
export function cmapCoverage(font: Uint8Array): Covers {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const cmap = tableOffset(v, "cmap");
  const sub = pickSubtable(v, cmap);
  const ranges = v.getUint16(sub) === 12 ? format12(v, sub) : format4(v, sub);
  return (c) => {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [s, e] = ranges[mid];
      if (c < s) hi = mid - 1;
      else if (c > e) lo = mid + 1;
      else return true;
    }
    return false;
  };
}

function tableOffset(v: DataView, tag: string): number {
  const numTables = v.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const name = String.fromCharCode(v.getUint8(rec), v.getUint8(rec + 1), v.getUint8(rec + 2), v.getUint8(rec + 3));
    if (name === tag) return v.getUint32(rec + 8);
  }
  throw new Error(`font has no ${tag} table`);
}

/** Prefers a full-Unicode (format 12) subtable, then a BMP (format 4) one. */
function pickSubtable(v: DataView, cmap: number): number {
  const n = v.getUint16(cmap + 2);
  let bmp = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = v.getUint16(rec);
    const encoding = v.getUint16(rec + 2);
    const sub = cmap + v.getUint32(rec + 4);
    const format = v.getUint16(sub);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (unicode && format === 12) return sub;
    if (unicode && format === 4 && bmp < 0) bmp = sub;
  }
  if (bmp < 0) throw new Error("font has no Unicode cmap subtable");
  return bmp;
}

function format12(v: DataView, sub: number): Range[] {
  const groups = v.getUint32(sub + 12);
  const out: Range[] = [];
  for (let i = 0; i < groups; i++) {
    const g = sub + 16 + i * 12;
    out.push([v.getUint32(g), v.getUint32(g + 4)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function format4(v: DataView, sub: number): Range[] {
  const segs = v.getUint16(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const rangeOffsets = deltas + segs * 2;
  const out: Range[] = [];
  for (let i = 0; i < segs; i++) {
    const start = v.getUint16(starts + i * 2);
    const end = v.getUint16(ends + i * 2);
    const delta = v.getInt16(deltas + i * 2);
    const ro = v.getUint16(rangeOffsets + i * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (ro === 0) glyph = (c + delta) & 0xffff;
      else {
        glyph = v.getUint16(rangeOffsets + i * 2 + ro + (c - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph === 0) continue;
      const last = out[out.length - 1];
      if (last && last[1] === c - 1) last[1] = c;
      else out.push([c, c]);
    }
  }
  return out;
}

/** Joiners and variation selectors: shaping hints, not glyphs of their own. */
const isFormatHint = (c: number) => c === 0x200c || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xe0100 && c <= 0xe01ef);

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Drops every grapheme containing a code point no font covers (emoji, other scripts), and
 * any uncovered joiner/selector left in the rest. Whitespace is collapsed and trimmed.
 */
export function fitToFonts(text: string, covers: Covers): string {
  let out = "";
  for (const { segment } of graphemes.segment(text)) {
    const cps = [...segment].map((ch) => ch.codePointAt(0)!);
    if (cps.some((c) => !isFormatHint(c) && !covers(c))) continue;
    out += cps.filter((c) => covers(c) || !isFormatHint(c)).map((c) => String.fromCodePoint(c)).join("");
  }
  return out.replace(/\s+/g, " ").trim();
}
