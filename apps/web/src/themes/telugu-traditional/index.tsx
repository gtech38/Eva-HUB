/**
 * Telugu Traditional — gruhapravesam, annaprasana, upanayanam, half-saree, naming ceremonies
 * (docs/05-theme-references.md). Turmeric, kumkum red, mango-leaf green on cream; a toran
 * (mango-leaf garland) runs along the top; Marcellus + Noto Serif Telugu for headings.
 */
import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#fff8e7",          // cream
  "--surface": "#fffdf6",
  "--fg": "#2e1a0e",
  "--muted": "#6b5543",
  "--accent": "#b3261e",      // kumkum
  "--accent-2": "#e0a526",    // turmeric
  "--accent-3": "#3f6b3e",    // mango leaf
  "--accent-fg": "#fff8e7",
  "--line": "#efdcb0",
  "--radius": "4px",
  "--font-display": "var(--font-marcellus), var(--font-telugu-serif), var(--font-devanagari-serif)",
  "--font-body": "var(--font-cormorant), var(--font-telugu-serif), var(--font-devanagari-serif)",
  "--font-script": "var(--font-marcellus)",
};

/** Kalasam: a brass pot with coconut and mango leaves — the auspicious marker of a Telugu ceremony. */
function Kalasam() {
  return (
    <svg viewBox="0 0 64 72" className="h-16 w-14" fill="none" aria-hidden>
      <path d="M20 44h24l-3 22H23z" fill="var(--accent-2)" />
      <path d="M16 38h32v6H16z" fill="var(--accent-2)" />
      <ellipse cx="32" cy="30" rx="9" ry="8" fill="#7a4a1e" />
      <path d="M32 26c-8-10-16-8-20-2 6-1 12 1 20 2zM32 26c8-10 16-8 20-2-6-1-12 1-20 2zM32 24c-3-9 0-16 4-20 1 7-1 13-4 20zM32 24c3-9 0-16-4-20-1 7 1 13 4 20z" fill="var(--accent-3)" />
      <path d="M22 50h20M23 56h18" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

function Divider() {
  return (
    <div className="my-12 flex items-center justify-center gap-3" aria-hidden>
      <span className="h-px w-16" style={{ background: "var(--accent-2)" }} />
      <span className="h-2 w-2 rotate-45" style={{ background: "var(--accent)" }} />
      <span className="h-2 w-2 rotate-45" style={{ background: "var(--accent-2)" }} />
      <span className="h-2 w-2 rotate-45" style={{ background: "var(--accent-3)" }} />
      <span className="h-px w-16" style={{ background: "var(--accent-2)" }} />
    </div>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, copy, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body text-[1.0625rem]">
      <div className="toran" aria-hidden />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-4 sm:flex-row sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            {monogram && (
              <span className="flex h-10 w-10 items-center justify-center rounded-full font-display text-sm" style={{ background: "var(--accent-2)", color: "var(--accent)" }}>
                {monogram}
              </span>
            )}
            <span className="font-display text-xl tracking-[0.08em] text-[color:var(--accent)]">{title}</span>
          </Link>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center font-display text-[0.78rem] tracking-[0.08em]" />}
            <div className="flex items-center gap-4 text-sm">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 fade-in">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-10 text-center">
          <Divider />
          <p className="text-base text-muted">{copy.signoff}</p>
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, headline, dateLine, startsOn, timezone, locale, heroUrl, copy }: HeroProps) {
  return (
    <section className="turmeric-frame relative overflow-hidden bg-surface">
      {heroUrl && (
        <div className="absolute inset-0 opacity-25" style={{ backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} aria-hidden />
      )}
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-16 text-center sm:py-24">
        <Kalasam />
        <p className="mt-5 font-display text-sm tracking-[0.3em] text-[color:var(--accent-3)]">{"శుభం"}</p>
        <p className="mt-4 text-base text-muted">{copy.invite}</p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-[color:var(--accent)] sm:text-6xl">{title}</h1>
        <p className="mt-3 font-display text-xl text-[color:var(--accent-2)]">{copy.accent}</p>
        {headline && <p className="mt-6 max-w-xl text-lg">{headline}</p>}
        <p className="mt-3 text-base uppercase tracking-[0.2em] text-muted">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-10 text-[color:var(--accent)]">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

export const teluguTraditional: Theme = { key: "TELUGU_TRADITIONAL", name: "Telugu Traditional", vars, Shell, Hero, Divider };
