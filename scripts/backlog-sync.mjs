#!/usr/bin/env node
/**
 * Sync backlog/**.md → GitHub issues via the gh CLI. Idempotent: issues are matched by a
 * hidden `<!-- backlog:ID -->` marker. Usage:
 *   node scripts/backlog-sync.mjs            # create/update everything
 *   node scripts/backlog-sync.mjs --dry-run  # print the plan
 *   node scripts/backlog-sync.mjs WEB-012    # one ticket
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = process.env.BACKLOG_REPO ?? "gtech38/Eva-HUB";
// fileURLToPath (not .pathname): the repo path contains spaces, which .pathname percent-encodes.
const ROOT = fileURLToPath(new URL("../backlog/", import.meta.url));
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const only = args.filter((a) => !a.startsWith("--"));

function gh(...a) {
  return execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f.startsWith(".") || f.startsWith("._")) return [];
    if (statSync(p).isDirectory()) return walk(p);
    return f.endsWith(".md") && f !== "README.md" ? [p] : [];
  });
}

function parse(path) {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${path}: missing frontmatter`);
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith("[")) v = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    fm[mm[1]] = v;
  }
  for (const k of ["id", "title", "labels", "milestone"]) if (!fm[k]) throw new Error(`${path}: missing ${k}`);
  return { path, fm, body: m[2].trim() };
}

const tickets = walk(ROOT).map(parse);
const byId = Object.fromEntries(tickets.map((t) => [t.fm.id, t]));

// Existing issues: map backlog id → number
const existing = JSON.parse(gh("issue", "list", "-R", REPO, "--state", "all", "--limit", "500", "--json", "number,body,title,state"));
const numberById = {};
for (const i of existing) {
  const mm = i.body?.match(/<!-- backlog:([A-Z0-9-]+) -->/);
  if (mm) numberById[mm[1]] = i.number;
}

const milestones = Object.fromEntries(
  JSON.parse(gh("api", `repos/${REPO}/milestones?state=all&per_page=100`)).map((m) => [m.title, m.number]),
);

// Two passes so "Blocked by #n" can reference numbers of tickets created in this run.
const order = tickets.filter((t) => only.length === 0 || only.includes(t.fm.id));

function renderBody(t) {
  const deps = (t.fm.depends_on ?? []).map((d) => (numberById[d] ? `#${numberById[d]}` : `\`${d}\``));
  const epic = t.fm.epic && numberById[t.fm.epic] ? `Epic: #${numberById[t.fm.epic]}` : t.fm.epic ? `Epic: \`${t.fm.epic}\`` : "";
  const header = [
    `<!-- backlog:${t.fm.id} -->`,
    `**Backlog id:** \`${t.fm.id}\` · **Source:** \`${relative(join(ROOT, ".."), t.path)}\``,
    epic,
    deps.length ? `**Blocked by:** ${deps.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${t.body}\n`;
}

for (const pass of [1, 2]) {
  for (const t of order) {
    const labels = [...t.fm.labels];
    // Blocked while any dependency is not yet a CLOSED issue.
    const blocked = (t.fm.depends_on ?? []).some((d) => {
      const n = numberById[d];
      if (!n) return true;
      const st = existing.find((i) => i.number === n);
      return !st || st.state !== "CLOSED";
    });
    if (blocked && !labels.includes("status:blocked")) labels.push("status:blocked");
    // status:ready = fully specified AND unblocked; this is what agents filter on.
    if (!blocked && labels.includes("agent-ready") && !labels.includes("status:ready")) labels.push("status:ready");
    const body = renderBody(t);
    const ms = milestones[t.fm.milestone];
    if (!ms) throw new Error(`${t.fm.id}: unknown milestone "${t.fm.milestone}"`);

    if (pass === 1 && !numberById[t.fm.id]) {
      if (dry) {
        console.log(`CREATE ${t.fm.id} "${t.fm.title}" [${labels.join(", ")}] (${t.fm.milestone})`);
        numberById[t.fm.id] = 0;
        continue;
      }
      const url = gh("issue", "create", "-R", REPO, "--title", t.fm.title, "--body", body, "--milestone", t.fm.milestone, ...labels.flatMap((l) => ["--label", l]));
      const num = Number(url.split("/").pop());
      numberById[t.fm.id] = num;
      console.log(`created #${num} ${t.fm.id} ${t.fm.title}`);
    } else if (pass === 2) {
      const num = numberById[t.fm.id];
      if (!num) continue;
      if (dry) {
        console.log(`UPDATE #${num} ${t.fm.id}`);
        continue;
      }
      gh("issue", "edit", String(num), "-R", REPO, "--title", t.fm.title, "--body", body, "--milestone", t.fm.milestone);
      // labels: add ours, remove stale ones from our namespaces
      const current = JSON.parse(gh("issue", "view", String(num), "-R", REPO, "--json", "labels")).labels.map((l) => l.name);
      const ours = new Set(labels);
      const remove = current.filter((l) => /^(type|area|priority|size|status):|^agent-ready$/.test(l) && !ours.has(l));
      const add = labels.filter((l) => !current.includes(l));
      if (add.length || remove.length) {
        gh("issue", "edit", String(num), "-R", REPO, ...add.flatMap((l) => ["--add-label", l]), ...remove.flatMap((l) => ["--remove-label", l]));
      }
      console.log(`synced  #${num} ${t.fm.id}`);
    }
  }
}

// Report dangling references
for (const t of tickets) {
  for (const d of t.fm.depends_on ?? []) if (!byId[d]) console.warn(`WARN ${t.fm.id} depends on unknown ${d}`);
  if (t.fm.epic && !byId[t.fm.epic]) console.warn(`WARN ${t.fm.id} references unknown epic ${t.fm.epic}`);
}
console.log(`${tickets.length} tickets in backlog/`);
