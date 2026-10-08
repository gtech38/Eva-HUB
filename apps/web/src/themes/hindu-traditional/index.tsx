import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";

const vars = {
  "--bg": "#fff8ee",
  "--surface": "#fffdf8",
  "--fg": "#3a1410",
  "--muted": "#7d564d",
  "--accent": "#9b1b1b",
  "--accent-2": "#e8a317",
  "--accent-fg": "#fff8ee",
  "--line": "#efd9b8",
  "--radius": "6px",
  // Serif Devanagari pairs with Lora for Hindi headings; Noto Sans Telugu covers Telugu.
  "--font-display": "var(--font-lora), var(--font-devanagari-serif)",
  "--font-body": "var(--font-inter)",
  "--font-script": "var(--font-lora)",
};

function Divider() {
  return (
    <div className="my-10 flex items-center justify-center gap-2" aria-hidden>
      <span className="h-px w-16" style={{ background: "var(--accent-2)" }} />
      <span className="h-2 w-2 rotate-45" style={{ background: "var(--accent)" }} />
      <span className="h-2.5 w-2.5 rotate-45" style={{ background: "var(--accent-2)" }} />
      <span className="h-2 w-2 rotate-45" style={{ background: "var(--accent)" }} />
      <span className="h-px w-16" style={{ background: "var(--accent-2)" }} />
    </div>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body">
      <div className="rangoli-band" aria-hidden />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-5 sm:flex-row sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            {monogram && (
              <span
                className="flex h-11 w-11 rotate-45 items-center justify-center border-2"
                style={{ borderColor: "var(--accent-2)", color: "var(--accent)" }}
              >
                <span className="-rotate-45 font-display text-base font-semibold">{monogram}</span>
              </span>
            )}
            <span className="font-display text-2xl font-semibold" style={{ color: "var(--accent)" }}>
              {title}
            </span>
          </Link>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center text-[0.8rem] font-medium" />}
            <div className="flex items-center gap-4">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
        <div className="scallop" aria-hidden />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 fade-in">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center">
          <Divider />
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
      <div className="rangoli-band" aria-hidden />
    </div>
  );
}

function Hero({ title, monogram, headline, dateLine, startsOn, timezone, locale, heroUrl }: HeroProps) {
  return (
    <section className="paisley-frame relative overflow-hidden rounded-theme border border-line">
      <div
        className="absolute inset-0"
        style={
          heroUrl
            ? { backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center", opacity: 0.4 }
            : { background: "linear-gradient(160deg, #fff3dc 0%, #f7d59a 45%, #e9b26a 100%)" }
        }
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-16 text-center sm:py-24">
        <p className="mb-3 text-xs uppercase tracking-[0.35em]" style={{ color: "var(--accent)" }}>
          {"शुभ विवाह"}
        </p>
        {monogram && (
          <div className="mb-4 font-display text-4xl font-semibold" style={{ color: "var(--accent)" }}>
            {monogram}
          </div>
        )}
        <p className="font-display text-xl italic text-muted">{headline}</p>
        <h1 className="mt-2 font-display text-5xl font-semibold leading-tight sm:text-6xl" style={{ color: "var(--accent)" }}>
          {title}
        </h1>
        <p className="mt-5 text-base text-fg/80">{dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}</p>
        {startsOn && (
          <div className="mt-10">
            <Countdown startsOn={startsOn.toISOString()} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

export const hinduTraditional: Theme = { key: "HINDU_TRADITIONAL", name: "Elegant Hindu Traditional", vars, Shell, Hero, Divider };
