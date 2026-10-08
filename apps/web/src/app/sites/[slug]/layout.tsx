import type { CSSProperties, ReactNode } from "react";
import { eventCopy, hostsPageLabel } from "@/lib/eventCopy";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, ui, isLocale, type Locale } from "@hub/shared/i18n";
import { PAGE_PATHS } from "@hub/shared/pages";
import { getSite, type SiteContext } from "@/lib/site";
import { themeFor, type NavItem } from "@/themes";
import { SignIn } from "@/components/SignIn";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  if (!site) return { title: "Not found" };
  return { title: t(site.event.title as object, site.locale) };
}

const NAV_LABEL: Partial<Record<keyof typeof PAGE_PATHS, Parameters<typeof ui>[0]>> = {
  HOME: "home",
  ABOUT: "about",
  SCHEDULE: "schedule",
  TRAVEL: "travel",
  FAQ: "faq",
  REGISTRY: "registry",
  GALLERY: "gallery",
  RSVP: "rsvp",
};

function buildNav(site: SiteContext): NavItem[] {
  const { locale, path } = site;
  // Table-driven pages (schedule, RSVP, gallery) are always reachable; content pages only when present+enabled.
  const types = new Set<keyof typeof PAGE_PATHS>(["HOME", "SCHEDULE", "RSVP", "GALLERY"]);
  for (const p of site.event.pages) types.add(p.type);
  const order: Array<keyof typeof PAGE_PATHS> = ["HOME", "ABOUT", "SCHEDULE", "TRAVEL", "FAQ", "REGISTRY", "RSVP", "GALLERY"];
  return order
    .filter((ty) => types.has(ty))
    .map((ty) => {
      const href = PAGE_PATHS[ty];
      const key = NAV_LABEL[ty];
      return { href, label: key ? ui(key, locale) : hostsPageLabel(site.event.kind, locale), current: href === "/" ? path === "/" : path.startsWith(href) };
    });
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSite();
  if (!site) notFound();

  const { event, locale, viewer, brand, monogram } = site;
  const theme = themeFor(event.theme);
  const title = t(event.title as object, locale);
  const locales = event.enabledLocales.filter(isLocale) as Locale[];
  const style = theme.vars as CSSProperties;
  const copy = eventCopy(event.kind, locale);

  const shell = (viewerName: string | null, body: ReactNode) => (
    <div style={style} className={`min-h-dvh bg-bg text-fg ${theme.rootClass ?? ""}`} data-theme={event.theme} lang={locale}>
      <theme.Shell title={title} monogram={monogram} nav={buildNav(site)} locale={locale} locales={locales} brand={brand} copy={copy} viewerName={viewerName}>
        {body}
      </theme.Shell>
    </div>
  );

  if (!viewer) {
    return shell(
      null,
      <SignIn
        title={title}
        monogram={monogram}
        locale={locale}
        strings={{ signIn: ui("signIn", locale), signInHelp: ui("signInHelp", locale), sending: "…" }}
        divider={<theme.Divider />}
      />,
    );
  }

  if (event.status !== "LIVE" && !viewer.seesAllSubEvents) {
    return shell(
      viewer.principal.displayName,
      <section className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-3xl">{title}</h1>
        <p className="mt-4 text-muted">This site is not live yet. Please check back soon.</p>
      </section>,
    );
  }

  const viewerName = viewer.guest ? fullName(viewer.guest, viewer.principal.displayName ?? "Guest") : viewer.principal.displayName;
  return shell(viewerName ?? "Guest", children);
}
