import { describe, expect, it } from "vitest";
import { THEMES } from "@/themes";
import { ogCard, ogCardForEvent, titleFontSize } from "./ogCard.tsx";

const event = {
  title: { en: "Priya & Arjun", te: "ప్రియ & అర్జున్" },
  defaultLocale: "en",
  theme: "HINDU_TRADITIONAL" as const,
  themeOverrides: { monogram: "P&A", accent: "#123456" },
};

describe("ogCardForEvent (the card is a function of these event fields only)", () => {
  it("takes the default-locale title, the monogram override and the theme palette", () => {
    const v = THEMES.HINDU_TRADITIONAL.vars;
    expect(ogCardForEvent(event)).toEqual({
      title: "Priya & Arjun",
      monogram: "P&A",
      background: v["--bg"],
      foreground: v["--fg"],
      accent: v["--accent"],
      muted: v["--muted"],
    });
  });

  it("uses the event's default locale, never the visitor's (the asset is cached publicly)", () => {
    expect(ogCardForEvent({ ...event, defaultLocale: "te" }).title).toBe("ప్రియ & అర్జున్");
    expect(ogCardForEvent({ ...event, defaultLocale: "xx" }).title).toBe("Priya & Arjun");
  });

  it("has an empty monogram when the event has none, and an unknown theme falls back to luxury", () => {
    const card = ogCardForEvent({ ...event, themeOverrides: null, theme: "NOPE" as never });
    expect(card.monogram).toBe("");
    expect(card.background).toBe(THEMES.LUXURY.vars["--bg"]);
  });

  it("ignores anything else on the event (dates, hero, status)", () => {
    const leaky = { ...event, startsOn: new Date("2026-12-12"), heroKey: "x.webp", status: "LIVE" } as typeof event;
    expect(Object.keys(ogCardForEvent(leaky)).sort()).toEqual(["accent", "background", "foreground", "monogram", "muted", "title"]);
  });

  // Colour mapping per theme (not an image snapshot; pixel snapshots belong to #102).
  it("maps each of the three original themes' palettes", () => {
    for (const key of ["LUXURY", "ROMANTIC", "HINDU_TRADITIONAL"] as const) {
      expect(ogCardForEvent({ ...event, theme: key }), key).toMatchSnapshot(key);
    }
  });
});

describe("ogCard", () => {
  it("falls back to neutral colours when a theme lacks a variable", () => {
    const card = ogCard({ title: "T", monogram: "", vars: {} });
    expect(card).toMatchObject({ monogram: "", background: expect.stringMatching(/^#/), foreground: expect.stringMatching(/^#/) });
  });
});

describe("titleFontSize counts graphemes, not UTF-16 units", () => {
  it("short Telugu and Hindi titles are sized like short Latin ones", () => {
    // 12 and 15 graphemes, but 25 UTF-16 code units each.
    for (const s of ["శ్రీ ప్రియ & శ్రీ అర్జున్", "प्रिया और अर्जुन का विवाह"]) {
      expect(s.length, s).toBeGreaterThan(24);
      expect(titleFontSize(s), s).toBe(titleFontSize("Priya & Arjun"));
    }
  });
  it("shrinks long titles", () => {
    expect(titleFontSize("x".repeat(30))).toBeLessThan(titleFontSize("x".repeat(10)));
    expect(titleFontSize("x".repeat(60))).toBeLessThan(titleFontSize("x".repeat(30)));
  });
});
