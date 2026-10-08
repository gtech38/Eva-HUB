#!/usr/bin/env node
/**
 * Create the next-numbered ADR from docs/adr/0000-template.md.
 *   node scripts/adr-new.mjs "Use a Postgres job table"   # -> docs/adr/0009-use-a-postgres-job-table.md
 * ADR_DIR overrides the target directory (used by tests). Process: docs/adr/README.md.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = fileURLToPath(new URL("../docs/adr/", import.meta.url));
const NUMBERED = /^(\d{4})-.+\.md$/;

/** "Postgres `Job` table!" -> "postgres-job-table" */
export function slugify(title) {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // drop combining accents: "café" -> "cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("ADR title must contain at least one letter or digit");
  return slug;
}

/** YYYY-MM-DD in the local timezone (toISOString would give the UTC day, wrong in the evening). */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** One past the highest NNNN-*.md; the 0000 template and non-ADR files do not count. */
export function nextNumber(fileNames) {
  const used = fileNames.map((f) => NUMBERED.exec(f)?.[1]).filter(Boolean).map(Number);
  return Math.max(0, ...used) + 1;
}

/** Writes the new file and returns its path. Never overwrites: the number is always unused. */
export function createAdr({ dir = DEFAULT_DIR, title, date = localDate() }) {
  const templatePath = join(dir, "0000-template.md");
  if (!existsSync(templatePath)) throw new Error(`ADR template not found: ${templatePath}`);
  const slug = slugify(title);
  const id = String(nextNumber(readdirSync(dir))).padStart(4, "0");
  // Function replacers: a title like "costs $& more" must not be read as a replacement pattern.
  const heading = `# ADR-${id}: ${title.replace(/\s+/g, " ").trim()}`;
  const body = readFileSync(templatePath, "utf8")
    .replace("# ADR-NNNN: <Title>", () => heading)
    .replace("- Date: YYYY-MM-DD", () => `- Date: ${date}`);
  const file = join(dir, `${id}-${slug}.md`);
  writeFileSync(file, body, { flag: "wx" });
  return file;
}

function main(argv) {
  const title = argv.join(" ").trim();
  if (!title) {
    console.error('usage: node scripts/adr-new.mjs "<title>"');
    return 1;
  }
  try {
    console.log(createAdr({ dir: process.env.ADR_DIR || DEFAULT_DIR, title }));
    return 0;
  } catch (e) {
    console.error(`adr-new: ${e.message}`);
    return 1;
  }
}

// realpath on both sides: argv[1] keeps symlinks (/tmp), import.meta.url does not (/private/tmp).
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
