#!/usr/bin/env node
/**
 * Sync backlog/**.md → GitHub issues via the gh CLI. Idempotent: issues are matched by a
 * hidden `<!-- backlog:ID -->` marker and only edited when title/body/milestone/labels differ.
 * Usage:
 *   node scripts/backlog-sync.mjs            # validate, then create/update everything
 *   node scripts/backlog-sync.mjs --dry-run  # validate against GitHub and print the plan; writes nothing
 *   node scripts/backlog-sync.mjs --check    # parse + local validation only; no gh calls (CI)
 *   node scripts/backlog-sync.mjs WEB-012    # one ticket
 * Exit code 1 and no writes when any ticket fails validation.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = process.env.BACKLOG_REPO ?? "gtech38/Eva-HUB";
// fileURLToPath (not .pathname): the repo path contains spaces, which .pathname percent-encodes.
const ROOT = fileURLToPath(new URL("../backlog/", import.meta.url));
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));

// Labels the sync owns (added/removed to reflect the files) vs labels agents own (never removed).
const OURS = /^(type|area|priority|size|status):|^agent-ready$/;
const SYNC_STATUS = ["status:blocked", "status:ready"];
const AGENT_OWNED = new Set(["status:in-progress", "status:review"]);

// ---------------------------------------------------------------- gh wrapper
const RETRY_RE = /rate limit|secondary|abuse|\b429\b|\b403\b/i;
const MAX_RETRIES = 5;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let ghCalls = 0;

function gh(...a) {
  for (let attempt = 1; ; attempt++) {
    ghCalls++;
    try {
      return execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
      const stderr = String(e.stderr ?? e.message ?? "");
      if (attempt > MAX_RETRIES || !RETRY_RE.test(stderr)) {
        throw new Error(`gh ${a.slice(0, 3).join(" ")} failed: ${stderr.trim()}`);
      }
      const s = 30 * attempt;
      console.warn(`gh ${a.slice(0, 2).join(" ")}: rate limited; retry ${attempt}/${MAX_RETRIES} in ${s}s`);
      sleep(s * 1000);
    }
  }
}

function ghWrite(...a) {
  const out = gh(...a);
  sleep(300); // be gentle with the secondary rate limit on writes
  return out;
}

// ---------------------------------------------------------------- parsing
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f.startsWith(".")) return [];
    if (statSync(p).isDirectory()) return walk(p);
    return f.endsWith(".md") && f.toLowerCase() !== "readme.md" ? [p] : [];
  });
}

// Scalars may be bare, 'single-quoted' or "double-quoted"; a trailing ` # comment` is dropped.
function scalar(v) {
  const q = v.match(/^(['"])(.*)\1\s*(?:#.*)?$/);
  if (q) return q[1] === "'" ? q[2].replace(/''/g, "'") : q[2];
  return v.replace(/\s+#.*$/, "").trim();
}

function parse(path, errors) {
  const rel = relative(join(ROOT, ".."), path).split("\\").join("/");
  const raw = readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) {
    errors.push(`${rel}: missing frontmatter`);
    return null;
  }
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (!mm) continue;
    const v = mm[2].trim();
    const arr = v.match(/^\[([^\]]*)\]/);
    fm[mm[1]] = arr ? arr[1].split(",").map((s) => scalar(s.trim())).filter(Boolean) : scalar(v);
  }
  for (const k of ["id", "title", "labels", "milestone"]) if (!fm[k]) errors.push(`${rel}: missing ${k}`);
  for (const k of ["labels", "depends_on"]) {
    if (fm[k] !== undefined && !Array.isArray(fm[k])) errors.push(`${rel}: ${k} must be a [list]`);
  }
  fm.depends_on ??= [];
  if (fm.id && !basename(path).startsWith(`${fm.id}-`)) errors.push(`${rel}: id ${fm.id} does not match the filename prefix`);
  return { path, rel, fm, body: m[2].trim() };
}

// ---------------------------------------------------------------- local validation
const errors = [];
const tickets = walk(ROOT).map((p) => parse(p, errors)).filter(Boolean);
const byId = {};
for (const t of tickets) {
  if (byId[t.fm.id]) errors.push(`${t.rel}: duplicate id ${t.fm.id} (also ${byId[t.fm.id].rel})`);
  else byId[t.fm.id] = t;
}
for (const t of tickets) {
  for (const d of t.fm.depends_on) {
    if (d === t.fm.id) errors.push(`${t.fm.id}: depends on itself`);
    else if (!byId[d]) errors.push(`${t.fm.id}: depends_on unknown ticket ${d}`);
  }
  if (t.fm.epic && !byId[t.fm.epic]) errors.push(`${t.fm.id}: unknown epic ${t.fm.epic}`);
  for (const l of t.fm.labels ?? []) {
    if (l.startsWith("status:")) errors.push(`${t.fm.id}: ${l} is managed by the sync; remove it from labels`);
  }
  if (t.fm.labels?.includes("agent-ready") && t.fm.labels.includes("size:L")) {
    errors.push(`${t.fm.id}: size:L tickets cannot be agent-ready (split first)`);
  }
}
for (const id of only) if (!byId[id]) errors.push(`argument ${id}: no such ticket in backlog/`);

function fail() {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`${errors.length} problem(s); nothing written`);
  process.exitCode = 1;
}

if (errors.length) {
  fail();
} else if (check) {
  console.log(`${tickets.length} tickets in backlog/ parse and validate`);
} else {
  sync();
}

// ---------------------------------------------------------------- GitHub
function sync() {
  const existing = JSON.parse(
    gh("issue", "list", "-R", REPO, "--state", "all", "--limit", "500", "--json", "number,title,body,state,labels,milestone"),
  );
  const milestones = new Set(JSON.parse(gh("api", `repos/${REPO}/milestones?state=all&per_page=100`)).map((m) => m.title));
  const labels = new Set(JSON.parse(gh("label", "list", "-R", REPO, "--limit", "200", "--json", "name")).map((l) => l.name));

  // backlog id → issue (lowest number wins when a marker is duplicated).
  const issueById = {};
  for (const i of existing.sort((a, b) => a.number - b.number)) {
    const mm = i.body?.match(/<!-- backlog:([A-Z0-9-]+) -->/);
    if (!mm) continue;
    if (issueById[mm[1]]) console.warn(`WARN duplicate marker ${mm[1]} on #${issueById[mm[1]].number} and #${i.number}; using #${issueById[mm[1]].number}`);
    else issueById[mm[1]] = i;
  }

  for (const t of tickets) {
    if (!milestones.has(t.fm.milestone)) errors.push(`${t.fm.id}: unknown milestone "${t.fm.milestone}"`);
    for (const l of t.fm.labels) if (!labels.has(l)) errors.push(`${t.fm.id}: label "${l}" does not exist on ${REPO}`);
  }
  for (const l of [...SYNC_STATUS, ...AGENT_OWNED]) if (!labels.has(l)) errors.push(`label "${l}" does not exist on ${REPO}`);
  if (errors.length) return fail();

  const order = tickets.filter((t) => only.length === 0 || only.includes(t.fm.id));
  const numberOf = (id) => issueById[id]?.number;

  function renderBody(t) {
    const deps = t.fm.depends_on.map((d) => (numberOf(d) ? `#${numberOf(d)}` : `\`${d}\``));
    const epic = t.fm.epic ? (numberOf(t.fm.epic) ? `Epic: #${numberOf(t.fm.epic)}` : `Epic: \`${t.fm.epic}\``) : "";
    const header = [
      `<!-- backlog:${t.fm.id} -->`,
      `**Backlog id:** \`${t.fm.id}\` · **Source:** \`${t.rel}\``,
      epic,
      deps.length ? `**Blocked by:** ${deps.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return `${header}\n\n${t.body}\n`;
  }

  // Labels the issue should end up with, given the ticket, its deps and what agents set on it.
  function desiredLabels(t, issue) {
    const current = issue?.labels.map((l) => l.name) ?? [];
    const want = new Set(t.fm.labels);
    const closed = issue?.state === "CLOSED";
    const blocked = t.fm.depends_on.some((d) => issueById[d]?.state !== "CLOSED");
    const agentHolds = current.some((l) => AGENT_OWNED.has(l));
    if (!closed) {
      if (blocked) want.add("status:blocked");
      // status:ready = fully specified AND unblocked AND nobody is on it; this is what agents filter on.
      else if (t.fm.labels.includes("agent-ready") && !agentHolds) want.add("status:ready");
    }
    for (const l of current) if (AGENT_OWNED.has(l) || !OURS.test(l)) want.add(l); // never touch agent-owned or foreign labels
    return [...want].sort();
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  // Pass 1: create missing issues so pass 2 can reference their numbers.
  for (const t of order) {
    if (issueById[t.fm.id]) continue;
    const labelsNow = desiredLabels(t, null);
    if (dry) {
      console.log(`CREATE ${t.fm.id} "${t.fm.title}" [${labelsNow.join(", ")}] (${t.fm.milestone})`);
      issueById[t.fm.id] = { number: 0, state: "OPEN", title: t.fm.title, body: "", labels: [], milestone: null };
      continue;
    }
    const body = renderBody(t);
    const url = ghWrite("issue", "create", "-R", REPO, "--title", t.fm.title, "--body", body, "--milestone", t.fm.milestone, ...labelsNow.flatMap((l) => ["--label", l]));
    const number = Number(url.split("/").pop());
    issueById[t.fm.id] = { number, state: "OPEN", title: t.fm.title, body, labels: labelsNow.map((name) => ({ name })), milestone: { title: t.fm.milestone } };
    created++;
    console.log(`created #${number} ${t.fm.id} ${t.fm.title}`);
  }

  // Pass 2: edit only what differs.
  for (const t of order) {
    const issue = issueById[t.fm.id];
    const { number } = issue;
    const body = renderBody(t);
    const want = desiredLabels(t, issue);
    const current = issue.labels.map((l) => l.name).sort();
    const add = want.filter((l) => !current.includes(l));
    const remove = current.filter((l) => !want.includes(l));
    const diff = [];
    if (issue.title !== t.fm.title) diff.push("title");
    if ((issue.body ?? "").replace(/\r\n?/g, "\n").trim() !== body.trim()) diff.push("body");
    if ((issue.milestone?.title ?? "") !== t.fm.milestone) diff.push("milestone");
    if (add.length || remove.length) diff.push(`labels(+${add.join(",")} -${remove.join(",")})`);
    if (!diff.length) {
      unchanged++;
      continue;
    }
    if (dry) {
      console.log(number ? `UPDATE #${number} ${t.fm.id}: ${diff.join(", ")}` : `UPDATE (new) ${t.fm.id}: ${diff.join(", ")}`);
      continue;
    }
    ghWrite(
      "issue", "edit", String(number), "-R", REPO,
      "--title", t.fm.title, "--body", body, "--milestone", t.fm.milestone,
      ...add.flatMap((l) => ["--add-label", l]),
      ...remove.flatMap((l) => ["--remove-label", l]),
    );
    updated++;
    console.log(`updated #${number} ${t.fm.id}: ${diff.join(", ")}`);
  }

  console.log(`${tickets.length} tickets in backlog/; ${order.length} considered: ${created} created, ${updated} updated, ${unchanged} unchanged${dry ? " (dry run)" : ""}; ${ghCalls} gh calls`);
}
