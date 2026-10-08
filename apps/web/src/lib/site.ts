/**
 * Per-request site context: which event this hostname is, who is looking, in what
 * language, and what they may see. Wrapped in React `cache` so the layout, the page
 * and any server action in the same request share one set of queries.
 */
import { cache } from "react";
import { headers, cookies } from "next/headers";
import { prisma, type Event, type Studio, type Guest, type Household, type EventPage } from "@hub/db";
import { can, type Principal, type Action } from "@hub/shared/policy";
import { SESSION_COOKIE, principalFromCookie } from "@hub/shared/auth";
import { isLocale, type Locale } from "@hub/shared/i18n";
import { env } from "@hub/shared/env";

export const LANG_COOKIE = "hub_lang";

export type Brand = { credit: string; url?: string; logoText?: string };
export type SitePrincipal = NonNullable<Awaited<ReturnType<typeof principalFromCookie>>>;

export type Viewer = {
  principal: SitePrincipal;
  /** This user's Guest row in this event (null for staff/hosts without one). */
  guest: (Guest & { household: Household }) | null;
  /** Hosts, planners, vendors, studio: see every sub-event, not just invited ones. */
  seesAllSubEvents: boolean;
  canHostsOnlyAlbums: boolean;
  /** Studio owner/staff/platform admin: may see HIDDEN albums. */
  isStudio: boolean;
  can: (action: Action) => boolean;
};

export type SiteContext = {
  slug: string;
  hostname: string;
  path: string;
  event: Event & { pages: EventPage[] };
  studio: Studio;
  brand: Brand;
  monogram: string;
  locale: Locale;
  /** Signed-in principal, whether or not they may view this site. */
  principal: SitePrincipal | null;
  /** Non-null only when the principal may view this site. */
  viewer: Viewer | null;
};

const hostFromHeaders = (h: Headers) => (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase().split(":")[0];

/** Domain table first, event slug second. */
export const resolveEvent = cache(async (hostname: string) => {
  const include = { studio: true, pages: { where: { enabled: true }, orderBy: { sortOrder: "asc" as const } } };
  const domain = hostname ? await prisma.domain.findUnique({ where: { hostname }, include: { event: { include } } }) : null;
  if (domain?.event) return domain.event;
  const slug = hostname.split(".")[0];
  if (!slug) return null;
  return prisma.event.findFirst({ where: { slug }, include, orderBy: { createdAt: "asc" } });
});

export const getPrincipal = cache(async () => {
  const jar = await cookies();
  return principalFromCookie(jar.get(SESSION_COOKIE)?.value);
});

export const getSite = cache(async (): Promise<SiteContext | null> => {
  const h = await headers();
  const hostname = hostFromHeaders(h);
  const ev = await resolveEvent(hostname);
  if (!ev) return null;
  const { studio, ...event } = ev;

  const jar = await cookies();
  const wanted = jar.get(LANG_COOKIE)?.value;
  const enabled = event.enabledLocales.filter(isLocale);
  const locale: Locale =
    wanted && isLocale(wanted) && enabled.includes(wanted) ? wanted : isLocale(event.defaultLocale) ? event.defaultLocale : "en";

  const principal = await getPrincipal();
  const res = { studioId: event.studioId, eventId: event.id };
  let viewer: Viewer | null = null;
  if (principal) {
    // An invitation session is scoped to the event it was issued for (invites get forwarded).
    const scopedElsewhere = principal.authMethod === "INVITE_LINK" && principal.guestScopeEventId !== event.id;
    if (!scopedElsewhere && can(principal, "site.view", res)) {
      const guest = await prisma.guest.findFirst({ where: { eventId: event.id, userId: principal.userId, deletedAt: null }, include: { household: true } });
      const isStudio = principal.isPlatformAdmin || !!principal.studioRoles[event.studioId];
      viewer = {
        principal,
        guest,
        seesAllSubEvents: can(principal, "rsvp.report", res),
        canHostsOnlyAlbums: can(principal, "gallery.view.hostsOnly", res),
        isStudio,
        can: (action) => can(principal, action, res),
      };
    }
  }

  const brandRaw = (studio.brandJson ?? {}) as Partial<Brand>;
  const brand: Brand = { credit: brandRaw.credit ?? studio.name, url: brandRaw.url, logoText: brandRaw.logoText };
  const overrides = (event.themeOverrides ?? {}) as { monogram?: string };

  return {
    slug: event.slug,
    hostname,
    path: h.get("x-hub-path") ?? "/",
    event,
    studio,
    brand,
    monogram: overrides.monogram ?? "",
    locale,
    principal,
    viewer,
  };
});

/** Pages call this; the layout has already rendered the sign-in screen if viewer is null. */
export async function requireViewer() {
  const site = await getSite();
  if (!site?.viewer) return null;
  return { ...site, viewer: site.viewer };
}

export function page<T extends EventPage["type"]>(site: SiteContext, type: T) {
  return site.event.pages.find((p) => p.type === type) ?? null;
}

/** Origin of the current site as the browser sees it (keeps the dev port). */
export function siteOrigin(site: Pick<SiteContext, "slug">) {
  const e = env();
  const proto = e.ROOT_DOMAIN === "localhost" ? "http" : "https";
  const port = e.ROOT_DOMAIN === "localhost" ? `:${e.WEB_PORT}` : "";
  return `${proto}://${site.slug}.${e.ROOT_DOMAIN}${port}`;
}
