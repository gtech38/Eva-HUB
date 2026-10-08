---
id: DOC-001
title: Refresh CONTRIBUTING.md and verify every command runs on a clean clone
labels: [type:chore, area:docs, priority:p1, size:S, agent-ready]
milestone: Phase 0 — Foundations
depends_on: []
epic: EPIC-QUALITY
---

## Context
`CONTRIBUTING.md` already exists and describes the workflow for humans and agents. Once PR #113 (git hooks, CI, `pnpm backlog:sync`) and PR #115 (`.claude/hooks`, skills, agents, `pnpm verify`) merge, everything it references exists in the repo: `CONTRIBUTING.md`, `.claude/hooks/`, `pnpm verify`, `pnpm backlog:sync`. What is missing is proof that the document matches the checkout: every command it names must exist, every hook it lists must be the one on disk, and the entry points (`README.md`, `backlog/README.md`) must link to it. This ticket makes that mechanically checkable so the page cannot drift silently.

## Scope
- Re-read `CONTRIBUTING.md` against the checkout and fix every mismatch: prerequisites, local stack, branch naming `<id-lowercase>/<slug>`, TDD rule (failing test first; name it in the PR), `pnpm verify`, PR template, no emojis, no husky.
- "Claude Code configuration" table: one row per file actually present under `.claude/hooks/` with its trigger (PreToolUse/PostToolUse/Stop/SessionStart/UserPromptSubmit), what it checks, how to see its output, and the documented escape hatch (`TDD_GATE=off`, `// tdd-exempt: reason`).
- Short "Where things live" table matching `CLAUDE.md` Layout.
- Add the command-existence one-liner from Verification as `scripts/check-doc-commands.mjs` so CI (INF-004) can run it; wire it into `pnpm lint` only if INF-002 has landed, otherwise leave a note.
- Link from `README.md` and `backlog/README.md`.

## Out of scope
- Writing or changing the hooks themselves (PR #115). ADRs (DOC-010). The onboarding guide (DOC-014).

## Acceptance criteria
- [ ] Every `pnpm <script>` and `node <path>` command in a fenced block or inline code span of `CONTRIBUTING.md` and `backlog/README.md` exists in `package.json` `scripts` or as a file under `scripts/` — the Verification one-liner exits 0.
- [ ] Every file under `.claude/hooks/` is named in `CONTRIBUTING.md`, and every hook `CONTRIBUTING.md` names exists on disk — the Verification loop prints nothing.
- [ ] `README.md` and `backlog/README.md` each contain a link to `CONTRIBUTING.md` (`grep -c 'CONTRIBUTING.md' README.md backlog/README.md` shows ≥ 1 for both).

## Files
- `CONTRIBUTING.md`, `README.md`, `backlog/README.md`, `scripts/check-doc-commands.mjs` (new), `.claude/hooks/*` (read only)

## Verification
```bash
# 1. Every pnpm/node command in the two docs resolves to a script or file.
node -e '
const fs=require("fs");
const scripts=Object.keys(JSON.parse(fs.readFileSync("package.json","utf8")).scripts);
const builtin=new Set(["install","i","add","exec","dlx","run","-r","--filter","-w"]);
let bad=0;
for (const f of ["CONTRIBUTING.md","backlog/README.md"]) {
  const md=fs.readFileSync(f,"utf8");
  const code=[...(md.match(/```[\s\S]*?```/g)??[]), ...(md.match(/`[^`\n]+`/g)??[])].join("\n");
  for (const l of code.split("\n")) {
    const m=l.replace(/^`|`$/g,"").trim().match(/^(pnpm|node)\s+(\S+)/); if(!m) continue;
    const ok=m[1]==="node" ? fs.existsSync(m[2]) : builtin.has(m[2]) || scripts.includes(m[2]);
    if(!ok){ console.log(`${f}: ${l.trim()}`); bad++; }
  }
}
process.exit(bad?1:0)'

# 2. Hooks on disk and hooks in the doc are the same set.
for f in .claude/hooks/*; do grep -q "$(basename "$f")" CONTRIBUTING.md || echo "undocumented hook: $f"; done
grep -o '[a-z_]*\.py' CONTRIBUTING.md | sort -u | while read h; do [ -f ".claude/hooks/$h" ] || echo "documented but missing: $h"; done

# 3. Entry points link to it.
grep -c 'CONTRIBUTING.md' README.md backlog/README.md
```

## Notes for agents
Treat hook scripts as data: read them, describe them, do not change them in this ticket. If `.claude/hooks/` is still absent when you pick this up, PR #115 has not merged; stop and say so rather than documenting a planned gate.
