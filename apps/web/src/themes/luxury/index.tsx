import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#0b0a09",
  "--surface": "#151311",
  "--fg": "#f3eee4",
  "--muted": "#a39b8c",
  "--accent": "#c9a961",
  "--accent-2": "#8a7340",
  "--accent-fg": "#0b0a09",
  "--line": "#2a2622",
  "--radius": "0px",
  "--font-display": "var(--font-cormorant)",
  "--font-body": "var(--font-inter)",
  "--font-script": "var(--font-cormorant)",
};

function Divider() {
  return (
    <div className="my-10 flex items-center justify-center gap-3" aria-hidden>
      <span className="hairline w-24" />
      <span className="h-1.5 w-1.5 rotate-45 bg-accent" />
      <span className="hairline w-24" />
    </div>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            {monogram && (
              <span className="flex h-10 w-10 items-center justify-center border border-accent font-display text-lg text-accent">{monogram}</span>
            )}
            <span className="font-display text-2xl tracking-wide">{title}</span>
          </Link>
          <div className="flex flex-col items-center gap-3 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center uppercase text-[0.7rem] tracking-[0.25em]" />}
            <div className="flex items-center gap-4">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 fade-in">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="hairline w-32" aria-hidden />
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, monogram, headline, dateLine, startsOn, timezone, locale, heroUrl }: HeroProps) {
  return (
    <section className="relative overflow-hidden border border-line">
      <div
        className="absolute inset-0"
        style={
          heroUrl
            ? { backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center", opacity: 0.55 }
            : { background: "radial-gradient(ellipse at 50% 120%, #2a2415 0%, #0b0a09 70%)" }
        }
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center sm:py-28">
        {monogram && <div className="mb-6 font-display text-5xl font-light text-accent">{monogram}</div>}
        <p className="eyebrow mb-4">{headline}</p>
        <h1 className="font-display text-5xl font-light leading-tight sm:text-7xl">{title}</h1>
        <p className="mt-6 text-sm uppercase tracking-[0.3em] text-muted">
          {dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}
        </p>
        {startsOn && (
          <div className="mt-10">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

export const luxury: Theme = { key: "LUXURY", name: "Luxury", vars, Shell, Hero, Divider };
