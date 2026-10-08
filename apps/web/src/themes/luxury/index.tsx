/**
 * Luxury — reference: Velvet Promise (docs/05-theme-references.md).
 * Burgundy velvet, cream, antique gold; Instrument Serif display with script initials.
 */
import Link from "next/link";
import type { Theme, ShellProps, HeroProps } from "../types";
import { Nav, LangSwitcher, NotYou, Credit } from "@/components/chrome";
import { Countdown } from "@/components/Countdown";
import { fmtDayLabel } from "@/lib/format";
import { splitCoupleNames } from "@hub/shared/names";

const vars = {
  "--bg": "#f7ead7",          // cream
  "--surface": "#fbf3e6",
  "--fg": "#2a0a10",          // near-burgundy ink on cream
  "--muted": "#7a5a52",
  "--accent": "#c9a961",      // antique gold
  "--accent-2": "#580b1b",    // burgundy
  "--accent-fg": "#2a0a10",
  "--line": "#e6d3b6",
  "--radius": "0px",          // squared frames and cards
  "--radius-btn": "999px",    // pill buttons, as in the reference
  "--font-display": "var(--font-instrument)",
  "--font-body": "var(--font-inter)",
  "--font-script": "var(--font-luxurious)",
};

function Divider() {
  return (
    <div className="my-12 flex items-center justify-center gap-4" aria-hidden>
      <span className="hairline w-28" />
      <span className="font-script text-3xl leading-none text-accent">&amp;</span>
      <span className="hairline w-28" />
    </div>
  );
}

/** Splits "Priya & Arjun" so each name can carry a script initial. */
function Names({ title, className = "" }: { title: string; className?: string }) {
  const parts = splitCoupleNames(title);
  if (!parts) return <span className={className}>{title}</span>;
  // Luxurious Script has Latin glyphs only; Telugu/Devanagari initials stay in the display face.
  const cls = (s: string) => (/^[A-Za-z]/.test(s) ? "initial-script" : undefined);
  return (
    <span className={className}>
      <span className={cls(parts[0])}>{parts[0]}</span>
      <span className="mx-3 align-middle text-[0.6em] font-light">&amp;</span>
      <span className={cls(parts[1])}>{parts[1]}</span>
    </span>
  );
}

function Shell({ title, monogram, nav, locale, locales, brand, viewerName, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col font-body">
      <header className="velvet text-[#f7ead7]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-5 sm:flex-row sm:justify-between">
          <Link href="/" className="font-display text-2xl tracking-wide">
            <Names title={title} />
          </Link>
          <div className="flex flex-col items-center gap-3 sm:items-end">
            {viewerName !== null && <Nav items={nav} className="justify-center text-[0.72rem] uppercase tracking-[0.22em] text-[#f7ead7]/85" />}
            <div className="flex items-center gap-4 text-[#f7ead7]/80">
              <LangSwitcher locale={locale} locales={locales} />
              {viewerName !== null && <NotYou locale={locale} viewerName={viewerName} />}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 fade-in">{children}</main>
      <footer className="velvet text-[#f7ead7]/80">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-10 text-center">
          {monogram && <span className="font-script text-4xl text-accent">{monogram}</span>}
          <span className="hairline w-32" aria-hidden />
          <Credit brand={brand} locale={locale} />
        </div>
      </footer>
    </div>
  );
}

function Hero({ title, headline, dateLine, startsOn, timezone, locale, heroUrl, copy }: HeroProps) {
  return (
    <section className="velvet relative -mx-4 -mt-12 overflow-hidden text-[#f7ead7] sm:mx-0 sm:mt-0">
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 sm:grid-cols-[1fr_auto] sm:py-28">
        <div className="text-center sm:text-left">
          <p className="font-display text-2xl text-[#e4e2b8]">{headline}</p>
          <p className="mt-1 font-body text-base tracking-[0.25em] text-[#f7ead7]/80">
            {dateLine || (startsOn ? fmtDayLabel(startsOn, timezone, locale) : "")}
          </p>
          <h1 className="mt-8 font-display text-6xl leading-[0.95] sm:text-8xl">
            <Names title={title} className="text-[#f7ead7]" />
          </h1>
          <p className="mt-8 text-xs uppercase tracking-[0.35em] text-[#f7ead7]/75">{copy.eyebrow}</p>
          {startsOn && (
            <div className="mt-10 text-[#f7ead7]">
              <Countdown startsOn={startsOn.toISOString()} locale={locale} />
            </div>
          )}
        </div>
        <div className="gold-frame mx-auto aspect-[4/5] w-56 rotate-2 sm:w-72" aria-hidden>
          <div
            className="h-full w-full"
            style={
              heroUrl
                ? { backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: "linear-gradient(160deg, #7a2a2f 0%, #3c0a12 60%, #2a0a10 100%)" }
            }
          />
        </div>
      </div>
    </section>
  );
}

export const luxury: Theme = { key: "LUXURY", name: "Luxury", vars, Shell, Hero, Divider };
