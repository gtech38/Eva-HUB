# Contributing

This repo is worked mostly by Claude Code agents picking up tickets, with humans reviewing. The rules below keep that safe.

## Workflow

1. **Tickets** are files in `backlog/` synced to GitHub issues (`pnpm backlog:sync`). See [backlog/README.md](backlog/README.md). Pick work with `gh issue list --label agent-ready --label status:ready`.
2. **Branch** `<id-lowercase>/<slug>` from `dev`. Feature PRs target `dev` and are squash-merged. `main` only receives promotion PRs from `dev` (titled `chore(release): …`, merged with a merge commit) once a major feature set is verified. Never push to `dev` or `main` directly; hooks and branch protection refuse it.
3. **TDD is enforced** by hooks in `.claude/`: a source file under `apps/`, `packages/` or `workers/` can only be edited when its test file exists; every edit re-runs typecheck and the sibling test; finishing a turn re-verifies touched packages. Details in `.claude/skills/tdd-workflow/SKILL.md`.
4. **Design rules** are in `.claude/skills/solid-design/SKILL.md` and `CLAUDE.md`. The non-negotiables: `can()` for authorisation, tenant scope on every query, adapters for external services, no biometric data outside `Face`/`FaceCluster`/`FaceProfile`.
5. **Verify** with `pnpm verify` before opening a PR.
6. **PR** title `<ID>: <title>`, body from the template, `Closes #n`.

## Local setup

See [README.md](README.md#running-locally). Everything runs on your machine; no cloud accounts are needed or created.

## Claude Code configuration

| Path | Purpose |
|---|---|
| `.claude/settings.json` | Hooks wiring and a permission allow-list for routine commands |
| `.claude/hooks/` | `tdd_gate.py` (PreToolUse), `post_edit_check.py` (PostToolUse), `stop_verify.py` (Stop), `session_start.py`, `prompt_context.py` |
| `.claude/skills/` | One skill per tool/library/area; `README.md` there lists them |
| `.claude/agents/` | `ticket-worker`, `test-author`, `solid-reviewer` |

Escape hatches exist (`TDD_GATE=off`, `// tdd-exempt: reason`) and are visible in review. Use them for wiring, never for behaviour.
