import { t, type LocalizedText } from "@hub/shared/i18n";

export function lt(x: unknown, locale: "en" | "te" | "hi" = "en"): string {
  if (x == null) return "";
  if (typeof x === "string") return x;
  return t(x as LocalizedText, locale);
}

export function fmtDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined) {
  return fmtDate(d, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtBytes(n: number | bigint | null | undefined) {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1; let x = v;
  do { x /= 1024; i++; } while (x >= 1024 && i < u.length - 1);
  return `${x.toFixed(x < 10 ? 1 : 0)} ${u[i]}`;
}

export function fmtCents(c: number | null | undefined, currency = "usd") {
  if (c == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(c / 100);
}

/** `datetime-local` input value in local time (no TZ suffix). */
export function toLocalInput(d: Date | string | null | undefined) {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function toDateInput(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function fullName(g: { firstName?: string | null; lastName?: string | null; isPlusOne?: boolean }) {
  const n = [g.firstName, g.lastName].filter(Boolean).join(" ").trim();
  return n || (g.isPlusOne ? "Plus-one (unnamed)" : "—");
}

export function pct(n: number, d: number) {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}
