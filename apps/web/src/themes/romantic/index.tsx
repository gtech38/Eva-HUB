import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#fbf5f1",
  "--surface": "#ffffff",
  "--fg": "#3b2f31",
  "--muted": "#8a7478",
  "--accent": "#c98a95",
  "--accent-2": "#e9c9c0",
  "--accent-fg": "#ffffff",
  "--line": "#eedcd8",
  "--radius": "14px",
  "--font-display": "var(--font-playfair)",
  "--font-body": "var(--font-inter)",
  "--font-script": "var(--font-great-vibes)",
};

function Divider() {
  return (
    <div className="my-10 flex items-center justify-center gap-3 text-accent" aria-hidden>
      <span className="h-px w-16 bg-line" />
      <span className="font-script text-2xl leading-none">&amp;</span>
      <span className="h-px w-16 bg-line" />
    </div>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, children }: ShellProps) {
  return (
    <div className="blush-glow flex min-h-dvh flex-col font-body">
      <header>
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 pt-8 pb-4">
          <Link href="/" className="flex flex-col items-center">
            {monogram && <span className="font-script text-4xl leading-none text-accent">{monogram}</span>}
            <span className="mt-1 font-display text-2xl italic">{title}</span>
          </Link>
          {viewerName !== null && <Nav items={nav} className="justify-center text-[0.8rem]" />}
          <div className="flex items-center gap-4">
            <LangSwitcher locale={locale} locales={locales} />
            {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 fade-in">{children}</main>
      <footer className="mt-8 border-t border-line bg-surface/60">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-1 px-4 py-8 text-center">
          <span className="font-script text-2xl text-accent" aria-hidden>
            with love
          </span>
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, monogram, headline, dateLine, startsOn, timezone, locale, heroUrl }: HeroProps) {
  return (
    <section className="relative overflow-hidden rounded-theme border border-line bg-surface shadow-[0_20px_60px_-30px_rgba(120,70,80,0.35)]">
      <div
        className="absolute inset-0"
        style={
          heroUrl
            ? { backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center", opacity: 0.35 }
            : { background: "linear-gradient(160deg, #fff7f3 0%, #f6dfd9 55%, #ecc9c2 100%)" }
        }
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-16 text-center sm:py-24">
        <p className="font-script text-4xl text-accent sm:text-5xl">{headline}</p>
        <h1 className="mt-3 font-display text-5xl leading-tight sm:text-6xl">{title}</h1>
        {monogram && <div className="mt-4 text-xs uppercase tracking-[0.35em] text-muted">{monogram}</div>}
        <p className="mt-5 text-base text-muted">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-10">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

export const romantic: Theme = { key: "ROMANTIC", name: "High-Class Romantic", vars, Shell, Hero, Divider };
