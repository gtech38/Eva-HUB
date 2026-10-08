import { describe, expect, it } from "vitest";
import { THEMES } from "@/themes";
import { OG_CACHE_CONTROL, ogCard, ogImageResponse } from "./ogCard.tsx";

// The three original themes (docs/05). A palette change shows up as a snapshot diff.
const THEME_VARS = {
  LUXURY: THEMES.LUXURY.vars,
  ROMANTIC: THEMES.ROMANTIC.vars,
  HINDU_TRADITIONAL: THEMES.HINDU_TRADITIONAL.vars,
};

const event = { eventTitle: { en: "Priya & Arjun", te: "ప్రియ & అర్జున్" }, defaultLocale: "en", monogram: "P&A" };

/** Width/height from the PNG IHDR chunk. */
function pngSize(buf: Uint8Array) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...buf.slice(0, 8)]).toEqual(sig);
  const v = new DataView(buf.buffer, buf.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

describe("ogCard (the OG image shows the sign-in screen's title and monogram only)", () => {
  it("snapshot: card per theme carries title, monogram and theme colours", () => {
    for (const [key, vars] of Object.entries(THEME_VARS)) {
      expect(ogCard({ ...event, vars }), key).toMatchSnapshot(key);
    }
  });

  it("uses the event's default locale, not the visitor's language (the asset is publicly cached)", () => {
    const card = ogCard({ ...event, defaultLocale: "te", vars: THEME_VARS.LUXURY });
    expect(card.title).toBe("ప్రియ & అర్జున్");
    expect(ogCard({ ...event, defaultLocale: "xx", vars: THEME_VARS.LUXURY }).title).toBe("Priya & Arjun");
  });

  it("carries nothing but title, monogram and colours", () => {
    const leaky = { ...event, vars: THEME_VARS.LUXURY, startsOn: "2026-12-12", heroUrl: "x.webp" } as Parameters<typeof ogCard>[0];
    expect(Object.keys(ogCard(leaky)).sort()).toEqual(["accent", "background", "foreground", "monogram", "muted", "title"]);
  });

  it("falls back to neutral colours when a theme lacks a variable", () => {
    const card = ogCard({ ...event, monogram: "", vars: {} });
    expect(card).toMatchObject({ monogram: "", background: expect.stringMatching(/^#/), foreground: expect.stringMatching(/^#/) });
  });

  it("renders a 1200x630 PNG that may be cached publicly for a day", async () => {
    for (const vars of Object.values(THEME_VARS)) {
      const res = ogImageResponse(ogCard({ ...event, vars }));
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe(OG_CACHE_CONTROL);
      expect(OG_CACHE_CONTROL).toBe("public, max-age=86400");
      expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    }
  });

  it("renders without a monogram (Liskov: every theme handles an empty monogram)", async () => {
    const res = ogImageResponse(ogCard({ ...event, monogram: "", vars: THEME_VARS.ROMANTIC }));
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
  });
});
