import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdr, nextNumber, slugify } from "./adr-new.mjs";

const SCRIPT = fileURLToPath(new URL("./adr-new.mjs", import.meta.url));
const REAL_TEMPLATE = fileURLToPath(new URL("../docs/adr/0000-template.md", import.meta.url));

const TEMPLATE = [
  "# ADR-NNNN: <Title>",
  "",
  "- Status: Proposed",
  "- Date: YYYY-MM-DD",
  "",
  "## Context",
  "",
].join("\n");

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adr-new-"));
  writeFileSync(join(dir, "0000-template.md"), TEMPLATE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const seed = (...names) => names.forEach((n) => writeFileSync(join(dir, n), "x"));

describe("slugify", () => {
  it("lowercases, hyphenates and strips punctuation", () => {
    expect(slugify("Postgres `Job` table: SKIP LOCKED!")).toBe("postgres-job-table-skip-locked");
  });
  it("rejects a title with no letters or digits", () => {
    expect(() => slugify("  ?!  ")).toThrow(/title/i);
  });
});

describe("nextNumber", () => {
  it("is 1 when only the template exists", () => {
    expect(nextNumber(["0000-template.md", "README.md"])).toBe(1);
  });
  it("is one past the highest numbered ADR, ignoring other files", () => {
    expect(nextNumber(["0000-template.md", "0001-a.md", "0008-b.md", "README.md", "notes.md"])).toBe(9);
  });
});

describe("createAdr", () => {
  it("creates 0009-test.md after eight ADRs (ticket acceptance criterion)", () => {
    seed(...Array.from({ length: 8 }, (_, i) => `000${i + 1}-adr-${i + 1}.md`));
    const file = createAdr({ dir, title: "test", date: "2026-10-08" });
    expect(file).toBe(join(dir, "0009-test.md"));
    expect(readdirSync(dir)).toContain("0009-test.md");
  });

  it("fills number, title, status and date from the template", () => {
    const file = createAdr({ dir, title: "Use a thing", date: "2026-10-08" });
    const text = readFileSync(file, "utf8");
    expect(text).toContain("# ADR-0001: Use a thing");
    expect(text).toContain("- Status: Proposed");
    expect(text).toContain("- Date: 2026-10-08");
    expect(text).not.toMatch(/NNNN|YYYY|<Title>/);
  });

  it("numbers consecutive calls without colliding", () => {
    const a = createAdr({ dir, title: "one", date: "2026-10-08" });
    const b = createAdr({ dir, title: "two", date: "2026-10-08" });
    expect(a.endsWith("0001-one.md")).toBe(true);
    expect(b.endsWith("0002-two.md")).toBe(true);
  });

  it("fails clearly when the template is missing", () => {
    rmSync(join(dir, "0000-template.md"));
    expect(() => createAdr({ dir, title: "x", date: "2026-10-08" })).toThrow(/template/i);
  });

  it("uses the real template shipped in docs/adr", () => {
    mkdirSync(join(dir, "real"));
    writeFileSync(join(dir, "real", "0000-template.md"), readFileSync(REAL_TEMPLATE, "utf8"));
    const text = readFileSync(createAdr({ dir: join(dir, "real"), title: "Smoke", date: "2026-10-08" }), "utf8");
    expect(text).toContain("# ADR-0001: Smoke");
    for (const section of ["Context", "Decision", "Consequences", "Alternatives", "References"]) {
      expect(text).toContain(`## ${section}`);
    }
  });
});

describe("CLI", () => {
  const run = (...args) =>
    spawnSync("node", [SCRIPT, ...args], { env: { ...process.env, ADR_DIR: dir }, encoding: "utf8" });

  it("prints the created path and exits 0", () => {
    const out = execFileSync("node", [SCRIPT, "smoke"], { env: { ...process.env, ADR_DIR: dir }, encoding: "utf8" });
    expect(out.trim()).toBe(join(dir, "0001-smoke.md"));
  });

  it("joins multiple words into one title", () => {
    run("two", "words");
    expect(readdirSync(dir)).toContain("0001-two-words.md");
  });

  it("exits 1 with usage when no title is given", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage/i);
  });
});
