---
id: DOC-014
title: Onboarding guide for new agents and developers
labels: [type:chore, area:docs, priority:p1, size:S, agent-ready]
milestone: Phase 0 — Foundations
depends_on: [DOC-001]
epic: EPIC-DOCS
---

## Context
A new agent today reads `CLAUDE.md`, then has to discover the seed accounts, where Mailpit is, how the worker is started, which tests exist and how tickets are worked. backlog/README.md and CONTRIBUTING (DOC-001) cover process; this guide covers "day one".

## Scope
- `docs/onboarding.md`: 30-minute path: prerequisites (Node 20, pnpm 9.15, Python 3.13, Docker), clone → `.env` → `pnpm infra:up` → migrate/seed → `pnpm dev` → worker `make venv && make models && make dev`; what you should see at each URL (sign in as `admin@localhost` via Mailpit, `priya-arjun.localhost:3000` gate, upload one photo, run a face search with the sample selfie — add `docs/onboarding/sample-selfie.jpg` generated synthetically or a CC0 face, never a real person); common failures (port 5433 in use, `*.localhost` on Safari, RustFS CORS, models missing) with fixes.
- "How the code is organised" tour with 10 files to read first (`site.ts`, `policy.ts`, `auth.ts`, `gallery.ts`, `face/search/route.ts`, `jobs.py`, `cluster_faces.py`, `schema.prisma`, `enqueue()`, `themes/types.ts`) and one sentence each.
- "Working a ticket" pointer to CONTRIBUTING + an example walkthrough of a small ticket (SHR-001) showing the failing-test-first flow.
- Glossary (household, sub-event, invite token vs login token, entitlement, cluster, profile, purge).
- Keep `CLAUDE.md` short; link to this guide from it.

## Out of scope
- Deployment (DOC-006).

## Acceptance criteria
- [ ] `docs/onboarding.md` and `docs/onboarding/sample-selfie.jpg` exist; `file docs/onboarding/sample-selfie.jpg` reports `JPEG image data`.
- [ ] Every `pnpm <script>`, `node <path>` and `make <target>` command in a fenced block or inline code span of `docs/onboarding.md` exists in `package.json` `scripts`, under `scripts/`, or as a target in `workers/media/Makefile` — the command-check one-liner in Verification exits 0.
- [ ] Every relative link in `docs/onboarding.md` resolves to a file in the repo (the ten "read first" files are written as relative links, so this covers them) — the link-check one-liner exits 0.
- [ ] `CLAUDE.md` and `README.md` each link to `docs/onboarding.md` (`grep -c 'docs/onboarding.md' CLAUDE.md README.md` shows ≥ 1 for both).

## Files
- `docs/onboarding.md`, `docs/onboarding/sample-selfie.jpg` (new), `CLAUDE.md`, `README.md`

## Verification
```bash
file docs/onboarding/sample-selfie.jpg
grep -c 'docs/onboarding.md' CLAUDE.md README.md

# Commands in the guide exist.
node -e '
const fs=require("fs");
const scripts=Object.keys(JSON.parse(fs.readFileSync("package.json","utf8")).scripts);
const targets=[...fs.readFileSync("workers/media/Makefile","utf8").matchAll(/^([a-z][\w-]*):/gm)].map(m=>m[1]);
const builtin=new Set(["install","i","add","exec","dlx","run","-r","--filter","-w"]);
const md=fs.readFileSync("docs/onboarding.md","utf8");
const code=[...(md.match(/```[\s\S]*?```/g)??[]), ...(md.match(/`[^`\n]+`/g)??[])].join("\n");
let bad=0;
for (const l of code.split("\n")) {
  const m=l.replace(/^`|`$/g,"").trim().match(/^(pnpm|node|make)\s+(\S+)/); if(!m) continue;
  const ok=m[1]==="node"?fs.existsSync(m[2]):m[1]==="make"?targets.includes(m[2]):builtin.has(m[2])||scripts.includes(m[2]);
  if(!ok){ console.log(l.trim()); bad++; }
}
process.exit(bad?1:0)'

# Relative links in the guide resolve.
node -e '
const fs=require("fs"),p=require("path");
let bad=0;
for (const m of fs.readFileSync("docs/onboarding.md","utf8").matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
  const t=m[1]; if (/^[a-z]+:/.test(t)) continue;
  if (!fs.existsSync(p.resolve("docs",t))) { console.log(`broken link ${t}`); bad++; }
}
process.exit(bad?1:0)'
```

## Notes for agents
Write for someone who has never seen the repo; prefer exact expected output over descriptions. Do the 30-minute walkthrough yourself on a clean clone before opening the PR and put the timings in the PR description; it is not an acceptance criterion because CI cannot assert it. The sample selfie must be synthetic or CC0 — say which in the PR.
