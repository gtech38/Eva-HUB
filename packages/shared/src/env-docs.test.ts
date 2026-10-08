// Contract tests for scripts/env-docs.mjs, the generator that keeps docs/deploy/env.md and .env.example
// in step with this package's env.ts and the worker's config.py. They live here because env.ts is the
// schema the generator reads; the script is exercised as a subprocess exactly as CI runs it.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/env-docs.mjs");
const ENV_TS = "packages/shared/src/env.ts";
const CONFIG_PY = "workers/media/hub_worker/config.py";
const EXAMPLE = ".env.example";
const DOC = "docs/deploy/env.md";

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A throwaway copy of just the files the generator reads and writes. */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "env-docs-"));
  temps.push(dir);
  for (const f of [ENV_TS, CONFIG_PY, EXAMPLE, DOC]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  return dir;
}

function edit(dir: string, file: string, fn: (s: string) => string) {
  const p = join(dir, file);
  const before = readFileSync(p, "utf8");
  const after = fn(before);
  expect(after).not.toBe(before);
  writeFileSync(p, after);
}

// Independent of the generator's own parser: the keys each parser reads, by the simplest regex that works.
function envTsKeys(): string[] {
  const src = readFileSync(join(ROOT, ENV_TS), "utf8");
  const body = src.slice(src.indexOf("z.object({"), src.indexOf("\n});"));
  return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
}
function configPyKeys(): string[] {
  const src = readFileSync(join(ROOT, CONFIG_PY), "utf8");
  const defaults = src.slice(src.indexOf("\nDEFAULTS"), src.indexOf("\n}", src.indexOf("\nDEFAULTS")));
  const dictKeys = [...defaults.matchAll(/^\s+"([A-Z][A-Z0-9_]+)":/gm)].map((m) => m[1]!);
  const getenvKeys = [...src.matchAll(/getenv\(\s*"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]!);
  return [...new Set([...dictKeys, ...getenvKeys])];
}

describe("scripts/env-docs.mjs --check", () => {
  it("passes on the committed tree", () => {
    const r = run("--check");
    expect(r.out).toContain("env docs up to date");
    expect(r.status).toBe(0);
  });

  it("fails when a new key is added to env.ts without a .env.example line", () => {
    const dir = fixture();
    edit(dir, ENV_TS, (s) => s.replace("  DATABASE_URL: z.string(),", "  DATABASE_URL: z.string(),\n  BRAND_NEW_KEY: z.string(),"));
    const r = run("--check", "--root", dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/BRAND_NEW_KEY.*\.env\.example/);
  });

  it("fails when a new variable is read in config.py outside DEFAULTS", () => {
    const dir = fixture();
    edit(dir, CONFIG_PY, (s) => s.replace("def load_settings(", 'X = os.getenv("WORKER_SHINY")\n\n\ndef load_settings('));
    const r = run("--check", "--root", dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/WORKER_SHINY/);
  });

  it("fails when .env.example lost a line", () => {
    const dir = fixture();
    edit(dir, EXAMPLE, (s) => s.replace(/^SESSION_TTL_DAYS=.*\n/m, ""));
    const r = run("--check", "--root", dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/\.env\.example.*SESSION_TTL_DAYS/);
  });

  it("fails when docs/deploy/env.md is stale", () => {
    const dir = fixture();
    edit(dir, DOC, (s) => s.replace(/^\| `ZIP_PART_BYTES` .*\n/m, ""));
    const r = run("--check", "--root", dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/docs\/deploy\/env\.md.*stale/);
  });

  it("write mode regenerates both files so the check passes again", () => {
    const dir = fixture();
    edit(dir, EXAMPLE, (s) => s.replace(/^SESSION_TTL_DAYS=.*\n/m, ""));
    edit(dir, DOC, (s) => s.replace(/^\| `ZIP_PART_BYTES` .*\n/m, ""));
    expect(run("--root", dir).status).toBe(0);
    expect(run("--check", "--root", dir).status).toBe(0);
    expect(readFileSync(join(dir, EXAMPLE), "utf8")).toBe(readFileSync(join(ROOT, EXAMPLE), "utf8"));
  });
});

describe("docs/deploy/env.md", () => {
  let doc = "";
  beforeAll(() => {
    doc = readFileSync(join(ROOT, DOC), "utf8");
  });
  const row = (key: string) => doc.split("\n").find((l) => l.startsWith(`| \`${key}\` `));

  it("lists every key from both parsers", () => {
    const keys = [...new Set([...envTsKeys(), ...configPyKeys()])];
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((k) => !row(k))).toEqual([]);
  });

  it("marks secrets and never prints their local values", () => {
    const example = readFileSync(join(ROOT, EXAMPLE), "utf8");
    for (const key of ["AUTH_SECRET", "DATABASE_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      expect(row(key), key).toMatch(/\| secret \|/);
      const value = example.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1];
      expect(value, key).toBeTruthy();
      expect(doc, key).not.toContain(value!);
    }
  });

  it("marks what production must set", () => {
    for (const key of ["AUTH_SECRET", "S3_PUBLIC_ENDPOINT", "EMAIL_PROVIDER", "ROOT_DOMAIN", "DATABASE_URL"]) {
      expect(row(key), key).toMatch(/\| \*\*required\*\* \|/);
    }
    expect(row("SESSION_TTL_DAYS")).toMatch(/\| optional \|/);
  });
});
