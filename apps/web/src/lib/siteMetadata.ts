/**
 * What crawlers and link unfurlers (WhatsApp, iMessage, Slack) may learn about an event
 * site: exactly what the signed-out sign-in screen shows (docs/01 §4). Every page on the
 * site inherits this from `sites/[slug]/layout.tsx`; inner pages add nothing.
 *
 * Deliberately takes only `title` and `origin`, so content, photos, guest names and dates
 * cannot reach a preview by accident.
 */
import type { Metadata } from "next";

export const OG_IMAGE_PATH = "/og.png";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SIGN_IN_DESCRIPTION = "You're invited — sign in to view";

/** Same as the root layout: nothing on an event site is indexable. */
const ROBOTS = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } as const;

export type SiteMetadataInput = { title: string; origin: string };

export function siteMetadata({ title, origin }: SiteMetadataInput): Metadata {
  return {
    metadataBase: new URL(origin),
    title,
    description: SIGN_IN_DESCRIPTION,
    robots: { ...ROBOTS, googleBot: { ...ROBOTS.googleBot } },
    openGraph: {
      title,
      description: SIGN_IN_DESCRIPTION,
      type: "website",
      images: [{ url: OG_IMAGE_PATH, ...OG_IMAGE_SIZE, alt: title }],
    },
    twitter: { card: "summary" },
  };
}
