/** Guest-site navigation. Pure so the page list, order and labels are unit-tested (the layout is a route shell). */
import type { EventKind } from "@hub/db";
import { ui, type Locale, type UIKey } from "@hub/shared/i18n";
import { PAGE_PATHS, type PageType } from "@hub/shared/pages";
import { hostsPageLabel } from "./eventCopy.ts";

/** One entry in the site nav. Defined here (lib) and re-exported by themes/types, so lib never imports from themes. */
export type NavItem = { href: string; label: string; current: boolean };

const NAV_LABEL: Partial<Record<PageType, UIKey>> = {
  HOME: "home",
  ABOUT: "about",
  SCHEDULE: "schedule",
  TRAVEL: "travel",
  FAQ: "faq",
  REGISTRY: "registry",
  GALLERY: "gallery",
  RSVP: "rsvp",
};

/** Order in the nav bar. */
const ORDER: readonly PageType[] = ["HOME", "ABOUT", "SCHEDULE", "TRAVEL", "WEDDING_PARTY", "FAQ", "REGISTRY", "RSVP", "GALLERY"];

/** Table-driven pages (schedule, RSVP, gallery) are always reachable; content pages only when enabled. */
const ALWAYS: readonly PageType[] = ["HOME", "SCHEDULE", "RSVP", "GALLERY"];

export function buildNavItems(input: { enabledPages: readonly PageType[]; kind: EventKind; locale: Locale; path: string }): NavItem[] {
  const { enabledPages, kind, locale, path } = input;
  const present = new Set<PageType>([...ALWAYS, ...enabledPages]);
  return ORDER.filter((ty) => present.has(ty)).map((ty) => {
    const href = PAGE_PATHS[ty];
    const key = NAV_LABEL[ty];
    // WEDDING_PARTY doubles as "Hosts"/"Family" for other event kinds.
    const label = key ? ui(key, locale) : hostsPageLabel(kind, locale);
    return { href, label, current: href === "/" ? path === "/" : path.startsWith(href) };
  });
}
