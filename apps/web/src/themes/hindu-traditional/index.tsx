/**
 * Elegant Hindu Traditional — reference: Jashn, gold frame from Shaadi (docs/05-theme-references.md).
 * Cream paper, deep maroon, gold line ornaments; Cinzel names, Pinyon Script accent, Cormorant body.
 */
import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#f6f4ee",          // cream paper
  "--surface": "#fffcf7",
  "--fg": "#212121",
  "--muted": "#4e4e4e",
  "--accent": "#450000",      // deep maroon
  "--accent-2": "#b8923e",    // gold
  "--accent-fg": "#fffcf7",
  "--line": "#e3d9c4",
  "--radius": "2px",
  // Cinzel has no Indic glyphs; Noto Serif Devanagari follows in the stack.
  "--font-display": "var(--font-cinzel), var(--font-devanagari-serif)",
  "--font-body": "var(--font-cormorant), var(--font-devanagari-serif)",
  "--font-script": "var(--font-pinyon)",
};

/** Gold floral line: two leaf strokes meeting at a bud. Pure SVG, no image assets. */
function Flourish({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 20" className={`h-5 w-40 ${className}`} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M0 10 H60 M100 10 H160" />
      <path d="M62 10c6-7 12-7 18 0-6 7-12 7-18 0z" />
      <path d="M98 10c-6-7-12-7-18 0 6 7 12 7 18 0z" />
      <circle cx="80" cy="10" r="2" fill="currentColor" />
      <path d="M44 10c4-4 8-4 12 0M104 10c4 4 8 4 12 0" />
    </svg>
  );
}

function Divider() {
  return (
    <div className="my-12 flex items-center justify-center text-[color:var(--accent-2)]" aria-hidden>
      <Flourish />
    </div>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, children }: ShellProps) {
  return (
    <div className="paper flex min-h-dvh flex-col font-body text-[1.0625rem]">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-5 sm:flex-row sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            {monogram && (
              <span className="gold-double-frame flex h-11 w-11 items-center justify-center font-display text-sm text-[color:var(--accent)]">
                {monogram}
              </span>
            )}
            <span className="font-display text-lg uppercase tracking-[0.18em] text-[color:var(--accent)]">{title}</span>
          </Link>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center font-display text-[0.7rem] uppercase tracking-[0.2em]" />}
            <div className="flex items-center gap-4 font-body text-sm">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 fade-in">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-10 text-center">
          <Flourish className="text-[color:var(--accent-2)]" />
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, headline, dateLine, startsOn, timezone, locale, heroUrl, copy }: HeroProps) {
  return (
    <section className="gold-double-frame grid overflow-hidden bg-surface sm:grid-cols-2">
      <div
        className="maroon-panel relative min-h-[18rem] sm:min-h-[34rem]"
        style={heroUrl ? { backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {heroUrl && <div className="absolute inset-0 bg-gradient-to-t from-[#2a0000]/80 via-[#2a0000]/40 to-transparent" aria-hidden />}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-[#f6f4ee]">
          <p className="font-script text-3xl sm:text-4xl">{copy.invite}</p>
          <h1 className="mt-3 font-display text-3xl uppercase tracking-[0.22em] sm:text-4xl">{title}</h1>
          <p className="mt-3 text-xs uppercase tracking-[0.4em] opacity-80">{copy.eyebrow}</p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center px-8 py-14 text-center">
        <Flourish className="text-[color:var(--accent-2)]" />
        <p className="mt-6 font-display text-sm uppercase tracking-[0.3em] text-[color:var(--accent)]">{headline}</p>
        <p className="mt-2 font-script text-5xl leading-none text-[color:var(--accent)] sm:text-6xl">{copy.accent}</p>
        <p className="mt-6 text-lg text-muted">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-10 text-[color:var(--accent)]">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
        <Flourish className="mt-8 rotate-180 text-[color:var(--accent-2)]" />
      </div>
    </section>
  );
}

export const hinduTraditional: Theme = { key: "HINDU_TRADITIONAL", name: "Elegant Hindu Traditional", vars, Shell, Hero, Divider };
