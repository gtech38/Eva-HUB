/** Pure helpers for checking ADR markdown (used by adr-docs.test.mjs). */

/** One page of prose; the template alone is about 130 words. */
export const MAX_WORDS = 450;

/** Body of the `## name` section, up to the next `## ` heading or end of text. */
export function section(text, name) {
  return new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text)?.[1] ?? "";
}

/** Backticked repo paths (tokens containing "/"), with `:line` or `#anchor` suffixes removed. */
export function citedPaths(text) {
  return [...text.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1].replace(/[:#].*$/, ""))
    .filter((p) => p.includes("/"));
}

/** Cited paths that are code or config, not planning docs or tickets. */
export function implementationPaths(text) {
  return citedPaths(text).filter((p) => !/^(docs|backlog)\//.test(p));
}

export function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}
