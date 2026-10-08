import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ADR_DIR = join(ROOT, "docs/adr");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const adrFiles = () => readdirSync(ADR_DIR).filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith("0000-")).sort();
const section = (text, name) => new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text)?.[1] ?? "";
const STATUSES = ["Proposed", "Accepted", "Superseded"];

describe("ADR process files", () => {
  it("ships a README and a template", () => {
    expect(existsSync(join(ADR_DIR, "README.md"))).toBe(true);
    expect(existsSync(join(ADR_DIR, "0000-template.md"))).toBe(true);
  });

  it("README documents numbering, statuses, when to write one and review in PRs", () => {
    const text = read("docs/adr/README.md");
    for (const status of STATUSES) expect(text).toContain(status);
    expect(text).toMatch(/when to write/i);
    expect(text).toMatch(/numbering|numbered/i);
    expect(text).toMatch(/pull request|PR/);
    expect(text).toContain("scripts/adr-new.mjs");
  });

  it("template has Context, Decision, Consequences, Alternatives and References", () => {
    const text = read("docs/adr/0000-template.md");
    for (const s of ["Context", "Decision", "Consequences", "Alternatives", "References"]) {
      expect(text).toContain(`## ${s}`);
    }
  });
});

describe("initial ADRs", () => {
  it("includes ADR 0001 to 0008", () => {
    const numbers = adrFiles().map((f) => f.slice(0, 4));
    for (let n = 1; n <= 8; n++) expect(numbers).toContain(String(n).padStart(4, "0"));
  });

  it("ADR 0008 stays Proposed until SHR-005 merges", () => {
    const file = adrFiles().find((f) => f.startsWith("0008-"));
    expect(read(`docs/adr/${file}`)).toMatch(/^- Status: Proposed/m);
  });

  describe.each(adrFiles())("%s", (file) => {
    const text = read(`docs/adr/${file}`);

    it("has a heading matching its number and a valid status", () => {
      expect(text).toMatch(new RegExp(`^# ADR-${file.slice(0, 4)}: \\S`, "m"));
      const status = /^- Status: (\w+)/m.exec(text)?.[1];
      expect(STATUSES).toContain(status);
    });

    it("has every template section", () => {
      for (const s of ["Context", "Decision", "Consequences", "Alternatives", "References"]) {
        expect(section(text, s).trim(), `section ${s}`).not.toBe("");
      }
    });

    it("fits on one page", () => {
      expect(text.split("\n").length).toBeLessThanOrEqual(70);
    });

    it("cites at least one implementing file, and every cited path exists", () => {
      const cited = [...section(text, "References").matchAll(/`([^`\s]+)`/g)]
        .map((m) => m[1].replace(/[:#].*$/, ""))
        .filter((p) => p.includes("/"));
      expect(cited.length).toBeGreaterThan(0);
      for (const p of cited) expect(existsSync(join(ROOT, p)), `${p} exists`).toBe(true);
    });
  });

  it("the index in docs/adr/README.md links every ADR", () => {
    const readme = read("docs/adr/README.md");
    for (const f of adrFiles()) expect(readme, f).toContain(`(${f})`);
  });
});

describe("entry points", () => {
  it.each(["README.md", "CLAUDE.md"])("%s links the ADR index", (file) => {
    expect(read(file)).toContain("docs/adr/README.md");
  });
});
