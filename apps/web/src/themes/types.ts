import type { ReactNode } from "react";
import type { ThemeKey } from "@hub/db";
import type { Locale } from "@hub/shared/i18n";
import type { Brand } from "@/lib/site";
import type { EventCopy } from "@/lib/eventCopy";

export type NavItem = { href: string; label: string; current: boolean };

export type ShellProps = {
  title: string;
  monogram: string;
  nav: NavItem[];
  locale: Locale;
  locales: Locale[];
  brand: Brand;
  copy: EventCopy;
  /** null when rendering the sign-in gate (no header nav / sign-out). */
  viewerName: string | null;
  children: ReactNode;
};

export type HeroProps = {
  title: string;
  monogram: string;
  headline: string;
  dateLine: string;
  startsOn: Date | null;
  timezone: string;
  locale: Locale;
  heroUrl: string | null;
  copy: EventCopy;
};

export type Theme = {
  key: ThemeKey;
  name: string;
  /** CSS custom properties applied on the theme root. */
  vars: Record<string, string>;
  rootClass?: string;
  Shell: (p: ShellProps) => ReactNode;
  Hero: (p: HeroProps) => ReactNode;
  Divider: () => ReactNode;
};
