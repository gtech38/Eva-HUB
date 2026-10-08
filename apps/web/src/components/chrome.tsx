/**
 * Theme-agnostic header/footer pieces. Each theme Shell lays these out its own way.
 */
import Link from "next/link";
import { LOCALE_NAMES, ui, type Locale } from "@hub/shared/i18n";
import type { NavItem } from "@/themes/types";
import type { Brand } from "@/lib/site";

export function Nav({ items, className = "" }: { items: NavItem[]; className?: string }) {
  return (
    <nav aria-label="Site" className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${className}`}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="nav-link" aria-current={it.current ? "page" : undefined}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function LangSwitcher({ locale, locales, className = "" }: { locale: Locale; locales: Locale[]; className?: string }) {
  if (locales.length < 2) return null;
  return (
    <div className={`flex items-center gap-1 text-xs ${className}`} aria-label="Language">
      {locales.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-40">·</span>}
          <a href={`?lang=${l}`} className={l === locale ? "font-semibold underline underline-offset-4" : "opacity-70 hover:opacity-100"} lang={l}>
            {LOCALE_NAMES[l]}
          </a>
        </span>
      ))}
    </div>
  );
}

export function NotYou({ locale, viewerName }: { locale: Locale; viewerName: string | null }) {
  return (
    <form action="/auth/signout" method="post" className="flex items-center gap-2 text-xs text-muted">
      {viewerName && <span className="truncate max-w-[10rem]">{viewerName}</span>}
      <button type="submit" className="underline underline-offset-4 hover:opacity-70">
        {ui("notYou", locale)}
      </button>
    </form>
  );
}

export function Credit({ brand, locale }: { brand: Brand; locale: Locale }) {
  const label = brand.credit.replace(/^Photography by\s+/i, "");
  const inner = (
    <>
      {ui("photographyBy", locale)} <span className="font-medium">{label}</span>
    </>
  );
  return (
    <p className="text-xs tracking-wide text-muted">
      {brand.url ? (
        <a href={brand.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">
          {inner}
        </a>
      ) : (
        inner
      )}
    </p>
  );
}
