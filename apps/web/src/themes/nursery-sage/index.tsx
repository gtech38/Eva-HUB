/**
 * Nursery Sage — baby showers (docs/05-theme-references.md).
 * Sage, warm cream and champagne gold; Cormorant italic display; crescent-moon and botanical line ornaments.
 */
import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#fbf8f2",          // warm cream
  "--surface": "#ffffff",
  "--fg": "#3d4238",          // deep sage-charcoal
  "--muted": "#7c8373",
  "--accent": "#8a9a7b",      // sage
  "--accent-2": "#c9b280",    // champagne gold
  "--accent-fg": "#ffffff",
  "--line": "#e6e1d5",
  "--radius": "18px",
  "--radius-btn": "999px",
  "--font-display": "var(--font-cormorant)",
  "--font-body": "var(--font-inter)",
  "--font-script": "var(--font-cormorant)",
};

/** A sprig: one stem, paired leaves. */
function Sprig({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 24" className={`h-6 w-32 ${className}`} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden>
      <path d="M4 12 H116" opacity=".5" />
      <path d="M40 12c4-8 12-8 16 0-4 8-12 8-16 0zM64 12c4-8 12-8 16 0-4 8-12 8-16 0z" />
      <circle cx="60" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" aria-hidden>
      <path d="M31 6a18 18 0 1 0 11 33A15 15 0 0 1 31 6z" fill="var(--accent-2)" opacity=".9" />
      <circle cx="12" cy="12" r="1.2" fill="var(--accent-2)" />
      <circle cx="8" cy="22" r=".9" fill="var(--accent-2)" />
    </svg>
  );
}

function Divider() {
  return (
    <div className="my-12 flex items-center justify-center text-[color:var(--accent)]" aria-hidden>
      <Sprig />
    </div>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, copy, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body">
      <header>
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-6 sm:flex-row sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            {monogram && <span className="font-display text-2xl italic text-[color:var(--accent)]">{monogram}</span>}
            <span className="font-display text-2xl">{title}</span>
          </Link>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center text-[0.78rem] tracking-wide" />}
            <div className="flex items-center gap-4">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 fade-in">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="font-display text-lg italic text-muted">{copy.signoff}</p>
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, headline, dateLine, startsOn, timezone, locale, heroUrl, copy }: HeroProps) {
  return (
    <section className="relative overflow-hidden rounded-theme border border-line bg-surface">
      {heroUrl && (
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} aria-hidden />
      )}
      <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full" style={{ background: "radial-gradient(circle, rgba(138,154,123,.18), transparent 70%)" }} aria-hidden />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center sm:py-28">
        <Moon />
        <p className="mt-6 text-[0.65rem] uppercase tracking-[0.4em] text-[color:var(--accent)]">{copy.eyebrow}</p>
        <h1 className="mt-4 font-display text-5xl italic leading-[1.05] sm:text-7xl">{title}</h1>
        <p className="mt-4 font-display text-2xl text-[color:var(--accent-2)]">{copy.accent}</p>
        {headline && <p className="mt-6 max-w-md text-base text-muted">{headline}</p>}
        <p className="mt-3 text-sm uppercase tracking-[0.2em] text-muted">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-10">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
        <Sprig className="mt-10 text-[color:var(--accent)]" />
      </div>
    </section>
  );
}

export const nurserySage: Theme = { key: "NURSERY_SAGE", name: "Nursery Sage", vars, Shell, Hero, Divider };
