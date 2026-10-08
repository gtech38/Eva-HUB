// tdd-exempt: wiring only; the card and response are decided and tested in lib/ogCard.
/**
 * GET /og.png on an event host: the link-preview image. No session required; it shows the
 * sign-in screen's monogram and title only, in the event's default locale, so the response
 * is identical for every visitor and may be cached publicly (lib/ogCard). Node runtime.
 */
import type { LocalizedText } from "@hub/shared/i18n";
import { getSite } from "@/lib/site";
import { ogCard, ogImageResponse } from "@/lib/ogCard";
import { themeFor } from "@/themes";

export const dynamic = "force-dynamic";

export async function GET() {
  const site = await getSite();
  if (!site) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const { event, monogram } = site;
  return ogImageResponse(
    ogCard({ eventTitle: event.title as LocalizedText, defaultLocale: event.defaultLocale, monogram, vars: themeFor(event.theme).vars }),
  );
}
