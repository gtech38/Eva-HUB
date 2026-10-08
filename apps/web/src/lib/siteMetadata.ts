/**
 * What crawlers and link unfurlers (WhatsApp, iMessage, Slack) may learn about an event
 * site: exactly what the signed-out sign-in screen shows (docs/01 §4). Every page on the
 * site inherits this from `sites/[slug]/layout.tsx`; inner pages add nothing.
 *
 * Deliberately takes only titles and an origin, so content, photos, guest names and dates
 * cannot reach a preview by accident.
 */
import type { Metadata } from "next";
import { isLocale, t, type LocalizedText } from "@hub/shared/i18n";

export const OG_IMAGE_PATH = "/og.png";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SIGN_IN_DESCRIPTION = "You're invited — sign in to view";

/** Same as the root layout: nothing on an event site is indexable. */
const ROBOTS = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } as const;

export type SiteMetadataInput = {
  /** Document title in the visitor's language (what the sign-in screen shows them). */
  title: string;
  /** og/twitter title: the event's default-locale title, the same text as /og.png. */
  previewTitle: string;
  origin: string;
};

export function siteMetadata({ title, previewTitle, origin }: SiteMetadataInput): Metadata {
  return {
    metadataBase: new URL(origin),
    title,
    description: SIGN_IN_DESCRIPTION,
    robots: { ...ROBOTS, googleBot: { ...ROBOTS.googleBot } },
    openGraph: {
      title: previewTitle,
      description: SIGN_IN_DESCRIPTION,
      type: "website",
      images: [{ url: OG_IMAGE_PATH, ...OG_IMAGE_SIZE, alt: previewTitle }],
    },
    twitter: { card: "summary" },
  };
}

/**
 * The title a crawler sees: crawlers send no `hub_lang` cookie, so the sign-in screen
 * renders in the event's default locale. /og.png uses the same text.
 */
export function eventPreviewTitle(event: { title: unknown; defaultLocale: string }): string {
  return t(event.title as LocalizedText | string, isLocale(event.defaultLocale) ? event.defaultLocale : "en");
}

/**
 * Origin for `metadataBase`, built from the host that resolved this event (so custom
 * domains keep their own origin). Same dev/prod rule as `siteOrigin`.
 */
export function originForHost(host: string, e: { ROOT_DOMAIN: string; WEB_PORT: number }): string {
  return e.ROOT_DOMAIN === "localhost" ? `http://${host}:${e.WEB_PORT}` : `https://${host}`;
}
