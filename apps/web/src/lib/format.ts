import type { Locale } from "@hub/shared/i18n";

const INTL: Record<Locale, string> = { en: "en-US", te: "te-IN", hi: "hi-IN" };

export function intlLocale(locale: Locale) {
  return INTL[locale];
}

export function fmtDate(d: Date, timeZone: string, locale: Locale, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(INTL[locale], { timeZone, dateStyle: "full", ...opts }).format(d);
}

export function fmtTime(d: Date, timeZone: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL[locale], { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtDateTime(d: Date, timeZone: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL[locale], { timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtDayLabel(d: Date, timeZone: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL[locale], { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
}

export function fullName(g: { firstName: string | null; lastName: string | null }, fallback = "Guest") {
  const n = [g.firstName, g.lastName].filter(Boolean).join(" ").trim();
  return n || fallback;
}
