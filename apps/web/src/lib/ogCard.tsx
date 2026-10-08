/**
 * The Open Graph card for an event site: the sign-in screen's monogram and title on the
 * theme's colours, nothing else (docs/01 §4). /og.png is served unauthenticated and cached
 * publicly, so the card is a function of a few event fields only, never of the visitor
 * (cookie, session, language).
 */
import type { Event } from "@hub/db";
import { themeFor } from "@/themes";
import { OG_IMAGE_SIZE, eventPreviewTitle } from "./siteMetadata";

export type OgCard = { title: string; monogram: string; background: string; foreground: string; accent: string; muted: string };

export type OgCardEvent = Pick<Event, "title" | "defaultLocale" | "theme" | "themeOverrides">;

const NEUTRAL = { background: "#faf8f5", foreground: "#1f1f1f", accent: "#8a7a5a", muted: "#6b6b6b" };

export function ogCard({ title, monogram, vars }: { title: string; monogram: string; vars: Readonly<Record<string, string>> }): OgCard {
  return {
    title,
    monogram,
    background: vars["--bg"] ?? NEUTRAL.background,
    foreground: vars["--fg"] ?? NEUTRAL.foreground,
    accent: vars["--accent"] ?? NEUTRAL.accent,
    muted: vars["--muted"] ?? NEUTRAL.muted,
  };
}

/** Same monogram the sign-in screen shows (`themeOverrides.monogram`, as in lib/site.ts). */
function monogramOf(overrides: Event["themeOverrides"]): string {
  const m = (overrides as { monogram?: unknown } | null)?.monogram;
  return typeof m === "string" ? m : "";
}

export function ogCardForEvent(event: OgCardEvent): OgCard {
  return ogCard({ title: eventPreviewTitle(event), monogram: monogramOf(event.themeOverrides), vars: themeFor(event.theme).vars });
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Shrinks long titles so they stay within two lines; counts what the reader sees. */
export function titleFontSize(title: string): number {
  const n = [...graphemes.segment(title)].length;
  return n <= 24 ? 84 : n <= 48 ? 64 : 48;
}

export function OgCardImage({ title, monogram, background, foreground, accent, muted }: OgCard) {
  return (
    <div
      style={{
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
        display: "flex",
        boxSizing: "border-box",
        background,
        padding: 32,
        fontFamily: "Noto Sans, Noto Sans Telugu, Noto Sans Devanagari",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          border: `2px solid ${muted}`,
          padding: "0 80px",
          textAlign: "center",
        }}
      >
        {monogram ? <div style={{ display: "flex", fontSize: 120, lineHeight: 1.2, color: accent }}>{monogram}</div> : null}
        <div style={{ display: "flex", width: 160, height: 2, background: accent, margin: "36px 0" }} />
        {title ? <div style={{ display: "flex", fontSize: titleFontSize(title), lineHeight: 1.3, color: foreground }}>{title}</div> : null}
      </div>
    </div>
  );
}
