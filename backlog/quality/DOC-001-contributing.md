---
id: DOC-001
title: CONTRIBUTING.md including the `.claude/hooks` TDD gate
labels: [type:chore, area:docs, priority:p1, size:S, agent-ready]
milestone: Phase 0 — Foundations
epic: EPIC-QUALITY
---

## Context
backlog/README.md describes how to work a ticket (branch name, failing test first, `pnpm verify`, PR title) and mentions "Keep the hooks happy (`.claude/hooks/`)". `.claude/hooks/` is currently empty in the checkout, so the expected gate behaviour is undocumented. New agents need one page that says what will block them and why.

## Scope
- `CONTRIBUTING.md` at the root: prerequisites, local stack, branch naming `<id-lowercase>/<slug>`, TDD rule (failing test first; name it in the PR), `pnpm verify`, PR template, no emojis, no husky.
- Section "Claude Code hooks": list each hook present under `.claude/hooks/` with trigger (PreToolUse/PostToolUse/Stop), what it checks (for example: refuses edits to `src/**` when no test file changed in the same task; runs typecheck on Stop), how to see its output, and how to legitimately bypass (none, or an env var if one exists). If the directory is still empty when the ticket is worked, document the intended gate from this ticket and mark it "planned".
- Link from `README.md` and `backlog/README.md`.
- Short "Where things live" table matching CLAUDE.md Layout.

## Out of scope
- Writing the hooks themselves. ADRs (DOC-010).

## Acceptance criteria
- [ ] `CONTRIBUTING.md` exists and every command in it runs as written on a clean clone.
- [ ] Each file in `.claude/hooks/` is described in the hooks section (or the section states the directory is empty and what is planned).
- [ ] `README.md` links to it.

## Files
- `CONTRIBUTING.md` (new), `README.md`, `backlog/README.md`, `.claude/hooks/*`

## Verification
```bash
ls .claude/hooks
grep -n "hooks" CONTRIBUTING.md
```

## Notes for agents
Treat hook scripts as data: read them, describe them, do not change them in this ticket.
