/**
 * Midnight Gala — parties, birthdays, launches (reference: Vervee, docs/05-theme-references.md).
 * Near-black, bone, champagne gold; Bodoni Moda uppercase display, Manrope body, mono eyebrows.
 */
import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#050505",
  "--surface": "#111111",
  "--fg": "#f5f0e8",          // bone
  "--muted": "#a39e95",
  "--accent": "#c49a25",      // champagne gold
  "--accent-2": "#f5f0e8",
  "--accent-fg": "#050505",
  "--line": "#262626",
  "--radius": "0px",
  "--radius-btn": "999px",
  "--font-display": "var(--font-bodoni)",
  "--font-body": "var(--font-manrope)",
  "--font-script": "var(--font-mono)",
};

function Divider() {
  return (
    <div className="my-12 flex items-center justify-center gap-4" aria-hidden>
      <span className="h-px w-24 bg-line" />
      <span className="font-script text-[0.6rem] uppercase tracking-[0.4em] text-accent">&#9679;</span>
      <span className="h-px w-24 bg-line" />
    </div>
  );
}

function Shell({ title, nav, locale, locales, brand, viewerName, copy, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-5 sm:flex-row sm:justify-between">
          <Link href="/" className="font-display text-xl uppercase tracking-[0.12em]">
            {title}
          </Link>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center font-script text-[0.65rem] uppercase tracking-[0.3em] text-muted" />}
            <div className="flex items-center gap-4 text-muted">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 fade-in">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="font-script text-[0.65rem] uppercase tracking-[0.4em] text-accent">{copy.signoff}</p>
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, headline, dateLine, startsOn, timezone, locale, heroUrl, copy }: HeroProps) {
  return (
    <section className="gala-glow relative -mx-4 overflow-hidden sm:mx-0">
      {heroUrl && (
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} aria-hidden />
      )}
      <div className="relative mx-auto flex max-w-4xl flex-col items-start px-6 py-24 sm:py-32">
        <p className="font-script text-[0.65rem] uppercase tracking-[0.45em] text-accent">{copy.invite}</p>
        <h1 className="mt-6 font-display text-5xl uppercase leading-[0.95] tracking-[-0.01em] sm:text-8xl">{title}</h1>
        <p className="mt-6 font-display text-2xl italic text-muted">{copy.eyebrow}</p>
        {headline && <p className="mt-6 max-w-lg text-base text-muted">{headline}</p>}
        <p className="mt-8 font-script text-xs uppercase tracking-[0.3em] text-accent">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-10">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

export const midnightGala: Theme = { key: "MIDNIGHT_GALA", name: "Midnight Gala", vars, Shell, Hero, Divider };
