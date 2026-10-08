/**
 * The Open Graph image for an event site: the sign-in screen's monogram and title on the
 * theme's colours, nothing else (docs/01 §4). Served unauthenticated at `/og.png` and cached
 * publicly, so it must not depend on the visitor (cookie, session, language).
 */
import { ImageResponse } from "next/og";
import { isLocale, t, type LocalizedText } from "@hub/shared/i18n";
import { OG_IMAGE_SIZE } from "./siteMetadata";

/** The one asset on an event site that may be cached: it carries no content. */
export const OG_CACHE_CONTROL = "public, max-age=86400";

export type OgCardInput = {
  eventTitle: LocalizedText | string;
  /** Event.defaultLocale: the title a crawler sees on the sign-in screen. */
  defaultLocale: string;
  monogram: string;
  /** Theme CSS custom properties (`Theme.vars`). */
  vars: Readonly<Record<string, string>>;
};

export type OgCard = { title: string; monogram: string; background: string; foreground: string; accent: string; muted: string };

const NEUTRAL = { background: "#faf8f5", foreground: "#1f1f1f", accent: "#8a7a5a", muted: "#6b6b6b" };

export function ogCard({ eventTitle, defaultLocale, monogram, vars }: OgCardInput): OgCard {
  return {
    title: t(eventTitle, isLocale(defaultLocale) ? defaultLocale : "en"),
    monogram,
    background: vars["--bg"] ?? NEUTRAL.background,
    foreground: vars["--fg"] ?? NEUTRAL.foreground,
    accent: vars["--accent"] ?? NEUTRAL.accent,
    muted: vars["--muted"] ?? NEUTRAL.muted,
  };
}

/** Shrinks long titles so they stay within two lines. */
const titleSize = (title: string) => (title.length <= 24 ? 84 : title.length <= 48 ? 64 : 48);

function OgCardImage({ title, monogram, background, foreground, accent, muted }: OgCard) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background, padding: 32 }}>
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
        {monogram ? <div style={{ display: "flex", fontSize: 120, lineHeight: 1, color: accent }}>{monogram}</div> : null}
        <div style={{ display: "flex", width: 160, height: 2, background: accent, margin: "36px 0" }} />
        <div style={{ display: "flex", fontSize: titleSize(title), lineHeight: 1.15, color: foreground }}>{title}</div>
      </div>
    </div>
  );
}

export function ogImageResponse(card: OgCard): ImageResponse {
  return new ImageResponse(<OgCardImage {...card} />, {
    ...OG_IMAGE_SIZE,
    headers: { "Cache-Control": OG_CACHE_CONTROL },
  });
}
