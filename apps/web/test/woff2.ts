/**
 * Minimal WOFF2 reader for tests: enough to look inside the vendored font files without
 * extra dependencies. Reads the table directory, brotli-decompresses the single table stream,
 * and exposes the untransformed `name` and `cmap` tables. Spec: https://www.w3.org/TR/WOFF2/
 */
import { brotliDecompressSync } from "node:zlib";

/** Table tags addressed by index in the directory flags byte (WOFF2 spec section 5.1). */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep",
  "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE",
  "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt",
  "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar",
  "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

export type Woff2 = { tables: Map<string, Buffer> };

function readBase128(buf: Buffer, pos: number): [value: number, next: number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos + i]!;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos + i + 1];
  }
  throw new Error("invalid UIntBase128");
}

export function parseWoff2(file: Buffer): Woff2 {
  if (file.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let pos = 48;
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[pos++]!;
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag: string;
    if (index === 63) {
      tag = file.toString("latin1", pos, pos + 4);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[index]!;
    }
    let length: number;
    [length, pos] = readBase128(file, pos);
    const glyfOrLoca = tag === "glyf" || tag === "loca";
    const transformed = glyfOrLoca ? version === 0 : version !== 0;
    if (transformed) [length, pos] = readBase128(file, pos);
    dir.push({ tag, length });
  }
  const stream = brotliDecompressSync(file.subarray(pos, pos + compressedSize));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const { tag, length } of dir) {
    tables.set(tag, stream.subarray(offset, offset + length));
    offset += length;
  }
  return { tables };
}

/** The set of name IDs present in the font's `name` table. */
export function nameIds(font: Woff2): Set<number> {
  const name = font.tables.get("name");
  if (!name) return new Set();
  const count = name.readUInt16BE(2);
  const ids = new Set<number>();
  for (let i = 0; i < count; i++) ids.add(name.readUInt16BE(6 + i * 12 + 6));
  return ids;
}

/** Whether the font maps `codePoint` to a glyph other than .notdef (cmap formats 4 and 12). */
export function hasGlyph(font: Woff2, codePoint: number): boolean {
  const cmap = font.tables.get("cmap");
  if (!cmap) return false;
  const numSubtables = cmap.readUInt16BE(2);
  for (let i = 0; i < numSubtables; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(offset);
    if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const at = offset + 16 + g * 12;
        const start = cmap.readUInt32BE(at);
        const end = cmap.readUInt32BE(at + 4);
        if (codePoint >= start && codePoint <= end && cmap.readUInt32BE(at + 8) + codePoint - start !== 0) return true;
      }
    } else if (format === 4 && codePoint <= 0xffff) {
      const segCount = cmap.readUInt16BE(offset + 6) / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segCount * 2 + 2;
      const deltas = startCodes + segCount * 2;
      const rangeOffsets = deltas + segCount * 2;
      for (let s = 0; s < segCount; s++) {
        if (codePoint > cmap.readUInt16BE(endCodes + s * 2)) continue;
        if (codePoint < cmap.readUInt16BE(startCodes + s * 2)) break;
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2);
        const delta = cmap.readUInt16BE(deltas + s * 2);
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (codePoint + delta) & 0xffff;
        } else {
          const at = rangeOffsets + s * 2 + rangeOffset + (codePoint - cmap.readUInt16BE(startCodes + s * 2)) * 2;
          glyph = cmap.readUInt16BE(at);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) return true;
        break;
      }
    }
  }
  return false;
}
