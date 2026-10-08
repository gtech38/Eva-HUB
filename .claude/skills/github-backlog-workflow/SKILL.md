---
name: github-backlog-workflow
description: Use when picking up, creating or finishing a ticket: backlog/README.md ticket format, pnpm backlog:sync (scripts/backlog-sync.mjs), label and milestone taxonomy, finding agent-ready issues with gh, branch naming <id>/<slug>, PR title "<ID>: title" with "Closes #n", running pnpm verify before a PR, the PR template, and a gh CLI cheat sheet for repo gtech38/Eva-HUB.
---

# GitHub backlog workflow

## When this applies
- Starting work: which ticket, which branch.
- Writing a new ticket or editing one.
- Opening or updating a PR.

## Where things live

| Path | What |
|---|---|
| `backlog/README.md` | ticket file format, `agent-ready` rules, "Working a ticket" steps |
| `backlog/<epic>/<ID>-<slug>.md` | one ticket per file (source of truth; GitHub is a mirror) |
| `scripts/backlog-sync.mjs` | `pnpm backlog:sync [--dry-run] [ID...]`; repo from `BACKLOG_REPO` (default `gtech38/Eva-HUB`); matches issues by `<!-- backlog:ID -->` marker |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist (written by another agent; fill every section) |
| `.github/ISSUE_TEMPLATE/` | issue forms (directory exists; tickets are normally created by the sync, not by hand) |
| `.claude/hooks/`, `.claude/settings.json` | TDD/verify hooks that run during work (see `tdd-workflow`) |
| root `package.json` | `pnpm verify` = typecheck + tests + python tests |

Repo: `https://github.com/gtech38/Eva-HUB.git`, default branch `main`. `gh` 2.x is installed and authenticated on this machine.

## Conventions in this repo

### Ticket format (from `backlog/README.md`)
```markdown
---
id: WEB-012                      # stable, never reused; prefix = area (WEB, ADMIN, WORKER, DB, SHARED, INFRA, DOCS, EPIC)
title: Guardian face search for child guests
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP         # must already exist on GitHub (sync throws otherwise)
depends_on: [WEB-010, WORKER-004] # ids; sync adds "Blocked by #n" and status:blocked while any is not CLOSED
epic: EPIC-FACE
---
## Context  ## Scope  ## Out of scope  ## Acceptance criteria (- [ ] testable)  ## Files  ## Verification  ## Notes for agents
```
`agent-ready` requires: observable acceptance criteria, verification commands, entry-point files, dependencies closed or stubbed, size S or M (split L first).

### Label taxonomy

| Namespace | Values (observed/intended) | Managed by sync |
|---|---|---|
| `type:` | `feature`, `bug`, `chore`, `docs`, `spike`, `epic` | yes |
| `area:` | `web`, `admin`, `worker`, `db`, `shared`, `infra`, `docs` | yes |
| `priority:` | `p0`, `p1`, `p2`, `p3` | yes |
| `size:` | `S`, `M`, `L` | yes |
| `status:` | `ready`, `blocked` (auto), `in-progress`, `review` | `blocked` auto; others set by sync from the file |
| `agent-ready` | flag | yes |

The sync removes labels in these namespaces that are not in the file and leaves any other label alone. Milestones follow the plan phases (`Phase 0 — Foundations`, `Phase 1 — MVP`, `Phase 2 — ...`, `Phase 3 — ...`).

## Common tasks

### Pick a ticket
```bash
gh issue list -R gtech38/Eva-HUB --label agent-ready --label status:ready --state open --limit 30
gh issue view <n> -R gtech38/Eva-HUB --comments
```
Prefer the lowest-numbered unblocked ticket in the current milestone; check "Blocked by" lines are all closed. Read the `Files` and the linked `docs/` sections before editing.

### Work it (TDD, from `backlog/README.md`)
```bash
git checkout main && git pull
git checkout -b web-012/guardian-face-search          # <id-lowercase>/<slug>
# 1. write the failing test named in Acceptance criteria / Verification; run it; watch it fail
# 2. implement until green, keeping .claude/hooks happy
pnpm verify                                             # typecheck + tests + make test (needs infra up)
```
Mark progress on GitHub only via labels: `gh issue edit <n> --add-label status:in-progress --remove-label status:ready` (the next sync will reset labels from the file -- update the file's `labels:` too if the state should stick).

### Open the PR
```bash
git push -u origin web-012/guardian-face-search
gh pr create -R gtech38/Eva-HUB --title "WEB-012: Guardian face search for child guests" \
  --body-file <(cat .github/PULL_REQUEST_TEMPLATE.md; echo; echo "Closes #<n>")
```
Title is exactly `<ID>: <ticket title>`. Body: filled template, tick the acceptance boxes, a short "how I verified" note with the commands you ran, and `Closes #<n>` so the issue auto-closes on merge. Commit messages end with the attribution line the harness provides. Do not commit unless asked (this session's rules), and never commit `.env`.

### Create or edit a ticket
1. Write `backlog/<epic>/<ID>-<slug>.md` (new id = next free number in the prefix; `grep -rho 'id: WEB-[0-9]*' backlog | sort -V | tail -1`).
2. `pnpm backlog:sync --dry-run` -> shows `CREATE`/`UPDATE` plan and warns on unknown `depends_on`/`epic`.
3. `pnpm backlog:sync <ID>` (one ticket) or `pnpm backlog:sync` (all). Milestones must exist: `gh api repos/gtech38/Eva-HUB/milestones -f title='Phase 1 — MVP'`.
4. Test the format first: the sync's `parse()` throws on missing `id/title/labels/milestone` -- the dry run is the test.

### Re-sync after editing an issue on GitHub
Do not. Edit the file and re-run the sync; it overwrites title/body/labels/milestone (idempotent by marker).

## gh cheat sheet
```bash
gh auth status
gh issue list -R gtech38/Eva-HUB --milestone 'Phase 1 — MVP' --state open
gh issue list -R gtech38/Eva-HUB --label status:blocked
gh issue view <n> --json title,labels,body -q '.body' | sed -n '1,20p'
gh issue edit <n> --add-label status:in-progress --remove-label status:ready
gh pr list -R gtech38/Eva-HUB --author @me
gh pr checks <pr>; gh pr view <pr> --web
gh pr comment <pr> --body "Verified: pnpm verify green; screenshots in te/hi attached."
gh api repos/gtech38/Eva-HUB/labels --paginate -q '.[].name' | sort
gh label create 'area:worker' -R gtech38/Eva-HUB --color 5319e7 --force
```

## Gotchas
- `scripts/backlog-sync.mjs` skips files starting with `.` or `._` (exFAT AppleDouble) and `README.md`; any other `.md` under `backlog/` is treated as a ticket and must have frontmatter.
- The sync's frontmatter parser is minimal: one `key: value` per line, arrays as `[a, b]` on one line, no quotes needed, no nested YAML.
- `status:blocked` is computed from `depends_on` at sync time; closing a dependency does not unblock until the next sync.
- First sync creates issues in two passes so "Blocked by #n" can reference numbers created in the same run; a dry run shows `#0`-less placeholders.
- `gh issue create` fails if a label does not exist -- create labels first (cheat sheet).
- `pnpm verify` runs `make test` in the worker, which needs Postgres up (`pnpm infra:up`) or it silently skips DB tests.
- Branch names must be lowercase (`web-012/...`); the id in the PR title stays uppercase.
- There is no CI workflow yet (`.github/workflows/` does not exist; docs/04 Phase 0 plans one), so `pnpm verify` locally is the only gate.
- Working directory is not reported as a git repo by some tools because of exFAT; `git` itself works (`git status`, `git log`).

## Verification
```bash
pnpm backlog:sync --dry-run                      # parses every ticket; no WARN lines
gh issue list -R gtech38/Eva-HUB --label agent-ready --limit 5
git branch --show-current                        # <id>/<slug>
pnpm verify
gh pr view --json title,body -q '.title'         # "<ID>: ..." and body contains "Closes #"
```

## References
- `backlog/README.md`
- `docs/04-plan.md` (phases = milestones; §2 long-lead items are candidate epics)
- gh CLI manual: https://cli.github.com/manual/
- GitHub "Closes #n" keywords: https://docs.github.com/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
- Related skills: `tdd-workflow`, `solid-design`, `pnpm-monorepo`
