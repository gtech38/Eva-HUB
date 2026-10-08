/**
 * High-Class Romantic — reference: Vow and Bloom (docs/05-theme-references.md).
 * Warm ivory, soft charcoal, dusty rose, sage; Inria Serif with tight tracking; falling petals.
 */
import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#f6f1e8",          // warm ivory
  "--surface": "#fff9f5",
  "--fg": "#2b2926",          // soft charcoal
  "--muted": "#756e67",
  "--accent": "#b88792",      // dusty rose
  "--accent-2": "#7a8068",    // sage
  "--accent-fg": "#fff9f5",
  "--line": "#d8d0c7",
  "--radius": "20px",         // soft cards
  "--radius-btn": "999px",    // pill buttons
  "--font-display": "var(--font-inria)",
  "--font-body": "var(--font-inter)",
  "--font-script": "var(--font-inria)",
};

function Divider() {
  return (
    <div className="my-12 flex items-center justify-center gap-3" aria-hidden>
      <span className="h-px w-20 bg-line" />
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="h-px w-20 bg-line" />
    </div>
  );
}

const PETALS = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 7.3 + 3) % 100}%`,
  delay: `${(i * 1.7) % 12}s`,
  duration: `${11 + (i % 5) * 2}s`,
  drift: `${(i % 2 ? 1 : -1) * (30 + (i % 4) * 25)}px`,
  scale: 0.7 + (i % 3) * 0.25,
}));

function Petals() {
  return (
    <div className="petals" aria-hidden>
      {PETALS.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration, ["--drift" as string]: p.drift, scale: String(p.scale) }}
        />
      ))}
    </div>
  );
}

function Shell({ title, nav, locale, locales, brand, viewerName, copy, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body">
      <header>
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-5 sm:flex-row sm:justify-between">
          <Link href="/" className="font-display text-xl tracking-[-0.02em]">
            {title}
          </Link>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center text-[0.8rem] tracking-[-0.01em]" />}
            <div className="flex items-center gap-4">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 fade-in">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-10 text-center">
          <span className="font-display text-lg tracking-[-0.02em]">{title}</span>
          <span className="text-xs uppercase tracking-[0.3em] text-muted">{copy.signoff}</span>
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, monogram, headline, dateLine, startsOn, timezone, locale, heroUrl, copy }: HeroProps) {
  return (
    <section className="relative overflow-hidden rounded-[28px]">
      <div
        className={`absolute inset-0 ${heroUrl ? "" : "ivory-sky"}`}
        style={heroUrl ? { backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        aria-hidden
      />
      {heroUrl && <div className="absolute inset-0 bg-gradient-to-b from-[#f6f1e8]/70 via-transparent to-[#f6f1e8]/40" aria-hidden />}
      <Petals />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center sm:py-32">
        <p className="text-[0.65rem] uppercase tracking-[0.4em] text-muted">{copy.eyebrow}</p>
        <h1 className="mt-6 font-display text-5xl leading-[1.02] tracking-[-0.03em] sm:text-7xl">{title}</h1>
        <p className="mt-4 font-display text-xl italic text-accent">{monogram || copy.accent}</p>
        {headline && <p className="mt-5 max-w-md text-base text-muted">{headline}</p>}
        <p className="mt-6 text-sm text-muted">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-12">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

export const romantic: Theme = { key: "ROMANTIC", name: "High-Class Romantic", vars, Shell, Hero, Divider };
