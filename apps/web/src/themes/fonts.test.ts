/**
 * WEB-012: theme fonts are self-hosted. `next/font` only accepts literal arguments, so fonts.ts
 * cannot be generated from data; instead this test reads it as text and checks the contract:
 * no Google fetch, every declared file is vendored with a licence, and every `--font-*` a theme
 * (or the global CSS / Tailwind stacks) references is declared by a local family.
 *
 * Themes are read as text too: their modules are TSX and the web vitest config keeps
 * `jsx: "preserve"` from tsconfig, so they cannot be imported here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const themesDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(themesDir, "../..");
const fontsSource = readFileSync(join(themesDir, "fonts.ts"), "utf8");

/** Variables that are theme slots (set per theme), not font families. */
const SLOTS = new Set(["--font-display", "--font-body", "--font-script"]);

type LocalFamily = { name: string; variable: string; paths: string[] };

function localFamilies(source: string): LocalFamily[] {
  const calls = [...source.matchAll(/export const (\w+) = localFont\(\{([\s\S]*?)\}\);/g)];
  return calls.map(([, name, body]) => ({
    name: name!,
    variable: /variable:\s*"(--font-[\w-]+)"/.exec(body!)?.[1] ?? "",
    paths: [...body!.matchAll(/path:\s*"([^"]+)"/g)].map((m) => resolve(themesDir, m[1]!)),
  }));
}

function referencedFontVars(text: string): string[] {
  return [...text.matchAll(/var\((--font-[\w-]+)\)/g)].map((m) => m[1]!).filter((v) => !SLOTS.has(v));
}

/** Every theme directory's index.tsx, keyed by directory name. */
function themeSources(): [string, string][] {
  return readdirSync(themesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(themesDir, d.name, "index.tsx")))
    .map((d) => [d.name, readFileSync(join(themesDir, d.name, "index.tsx"), "utf8")]);
}

/** The `--font-*` slot values a theme's `vars` sets, e.g. `"var(--font-cinzel), var(--font-devanagari-serif)"`. */
function themeFontSlots(source: string): string[] {
  return [...source.matchAll(/"--font-(?:display|body|script)":\s*"([^"]*)"/g)].map((m) => m[1]!);
}

const families = localFamilies(fontsSource);
const declared = new Set(families.map((f) => f.variable));

describe("themes/fonts.ts (self-hosted)", () => {
  it("does not import next/font/google", () => {
    // Any import/require of the module specifier; prose mentions in comments are fine.
    expect(fontsSource).not.toMatch(/["'`]next\/font\/google["'`]/);
  });

  it("declares every family with next/font/local", () => {
    expect(fontsSource).toMatch(/import localFont from "next\/font\/local";/);
    expect(families.length).toBeGreaterThanOrEqual(15);
    for (const f of families) {
      expect(f.variable, f.name).toMatch(/^--font-/);
      expect(f.paths.length, f.name).toBeGreaterThan(0);
    }
    expect(declared.size).toBe(families.length);
  });

  it("exposes every declared family through fontVariableClasses", () => {
    const list = /fontVariableClasses = \[([\s\S]*?)\]/.exec(fontsSource)?.[1] ?? "";
    for (const f of families) expect(list, f.name).toContain(`${f.name}.variable`);
  });

  it("keeps display: swap and preload: false on every family", () => {
    const calls = [...fontsSource.matchAll(/localFont\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]!);
    for (const body of calls) {
      expect(body).toMatch(/display:\s*"swap"/);
      expect(body).toMatch(/preload:\s*false/);
    }
  });

  it("points every src at a vendored woff2 under 5 MB", () => {
    for (const f of families) {
      for (const p of f.paths) {
        expect(p, f.name).toMatch(/\.woff2$/);
        expect(existsSync(p), p).toBe(true);
        expect(statSync(p).size, p).toBeLessThan(5_000_000);
      }
    }
  });

  it("ships a licence file in every font directory", () => {
    const dirs = new Set(families.flatMap((f) => f.paths.map((p) => dirname(p))));
    expect(dirs.size).toBeGreaterThan(0);
    for (const d of dirs) {
      const licence = readdirSync(d).filter((n) => /^(OFL|LICENSE)(\.txt)?$/.test(n));
      expect(licence, d).not.toHaveLength(0);
    }
  });

  it("checks every theme registered in themes/index.ts", () => {
    const registry = readFileSync(join(themesDir, "index.ts"), "utf8");
    const registered = [...registry.matchAll(/^import \{ \w+ \} from "\.\/([\w-]+)";$/gm)].map((m) => m[1]!);
    expect(registered.length).toBeGreaterThanOrEqual(6);
    expect(themeSources().map(([name]) => name).sort()).toEqual(registered.sort());
  });

  it.each(themeSources())("theme %s maps every --font-* variable to a local family", (_name, source) => {
    const slots = themeFontSlots(source);
    expect(slots).toHaveLength(3);
    const used = slots.flatMap(referencedFontVars);
    expect(used.length).toBeGreaterThanOrEqual(3);
    for (const v of used) expect([...declared], v).toContain(v);
  });

  it("maps the global CSS and Tailwind font stacks to local families", () => {
    const text =
      readFileSync(join(webDir, "src/app/globals.css"), "utf8") +
      readFileSync(join(webDir, "tailwind.config.ts"), "utf8");
    const used = referencedFontVars(text);
    expect(used).toEqual(expect.arrayContaining(["--font-telugu", "--font-devanagari"]));
    for (const v of used) expect([...declared], v).toContain(v);
  });
});
