import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { THEMES } from "@/themes";
import { ogCard } from "./ogCard.tsx";
import { loadOgFonts, type OgFonts } from "./ogFonts.ts";
import { renderOgPng } from "./ogRender.tsx";

const DIR = fileURLToPath(new URL("../../assets/og-fonts/", import.meta.url));

/** Width/height from the PNG IHDR chunk. */
function pngSize(buf: Uint8Array) {
  expect([...buf.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(buf.buffer, buf.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

let fonts: OgFonts;
beforeAll(async () => {
  fonts = await loadOgFonts(DIR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const TITLES = {
  telugu: { title: "ప్రియ & అర్జున్", monogram: "శ్రీ" },
  hindi: { title: "प्रिया और अर्जुन", monogram: "प्र" },
  emoji: { title: "Emma & Liam 🎉❤️👨‍👩‍👧", monogram: "💍" },
  latinExt: { title: "Zoë & Łukasz Ștefan — Ñandú", monogram: "Ž&Ł" },
  otherScript: { title: "婚礼 Wedding", monogram: "囍" },
};

describe("renderOgPng (local fonts only; no network at render time)", () => {
  it("renders te, hi, emoji and Latin-Ext titles to 1200x630 PNGs without calling fetch", async () => {
    const fetch = vi.fn(() => {
      throw new Error("network is not allowed while rendering /og.png");
    });
    vi.stubGlobal("fetch", fetch);
    for (const [name, t] of Object.entries(TITLES)) {
      const png = await renderOgPng(ogCard({ ...t, vars: THEMES.TELUGU_TRADITIONAL.vars }), fonts);
      expect(pngSize(png), name).toEqual({ width: 1200, height: 630 });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders with an empty monogram and a title that is all emoji (Liskov: nothing throws)", async () => {
    const png = await renderOgPng(ogCard({ title: "🎉🎉", monogram: "", vars: THEMES.ROMANTIC.vars }), fonts);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("is deterministic for the same card", async () => {
    const card = ogCard({ title: "Priya & Arjun", monogram: "P&A", vars: THEMES.LUXURY.vars });
    expect(Buffer.from(await renderOgPng(card, fonts)).equals(Buffer.from(await renderOgPng(card, fonts)))).toBe(true);
  });
});
