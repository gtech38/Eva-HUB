# Backlog as code

Every GitHub issue for this repo is authored here first as one markdown file, then synced to
GitHub with `pnpm backlog:sync`. The file is the source of truth; edit it and re-sync rather
than editing the issue on GitHub (the sync overwrites title, body, labels and milestone, and
is idempotent — it matches issues by the `<!-- backlog:<id> -->` marker in the body and only
edits an issue when something actually differs).

## File format

`backlog/<epic>/<id>-<slug>.md` — the filename must start with the `id`.

```markdown
---
# id is stable and never reused; it must match the filename prefix
id: WEB-012
title: Guardian face search for child guests
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
# ids of other tickets; the sync renders "Blocked by #n" and sets status:blocked while any is open
depends_on: [WEB-010, WRK-004]
# id of the umbrella issue
epic: EPIC-FACE
---

## Context
Why this exists; link to docs/ sections. Two to five sentences.

## Scope
Bullet list of exactly what to build.

## Out of scope
What is deliberately not part of this ticket.

## Acceptance criteria
- [ ] Observable, testable statements. Each becomes a test.

## Files
Paths an agent should expect to touch or read first.

## Verification
Exact commands / clicks that prove it works, including the failing-first test.

## Notes for agents
TDD order, SOLID boundaries to respect, gotchas.
```

Frontmatter rules the sync enforces:

- Scalars may be bare, `'single-quoted'` or `"double-quoted"`. Quote a title that starts with `"`
  or contains `: ` (for example `title: '"My events" cross-event dashboard'`). A trailing
  ` # comment` is ignored.
- Lists are `[a, b, c]` on one line; `depends_on: []` is fine.
- `labels` must exist on the repo. `status:*` labels are never written by hand — the sync owns them (see below).
- `depends_on` and `epic` must name tickets that exist in `backlog/`.
- `size:L` tickets cannot carry `agent-ready` (split them first).
- CRLF files are accepted.

## Running the sync

```bash
node scripts/backlog-sync.mjs --check     # parse + validate locally; no GitHub calls (CI runs this)
node scripts/backlog-sync.mjs --dry-run   # also validate labels/milestones against GitHub; print the plan
node scripts/backlog-sync.mjs             # create missing issues, update changed ones
node scripts/backlog-sync.mjs WEB-012     # one ticket
```

`pnpm backlog:sync` is the alias for the last two forms. Validation runs before any write; on
any problem the script prints every error, exits 1 and writes nothing. Unchanged issues cost
no API calls; `gh` is retried with back-off when GitHub rate-limits, so a full sync of a
hundred tickets is safe to run repeatedly.

## Status labels

| Label | Owner | Meaning |
|---|---|---|
| `status:blocked` | sync | At least one `depends_on` issue is still open |
| `status:ready` | sync | `agent-ready`, unblocked and nobody is on it — what agents filter on |
| `status:in-progress` | agent / person | Someone is working on it; set when you start |
| `status:review` | agent / person | A PR is open and awaiting review |
| `status:in-dev` | agent / person | Merged into `dev`; the issue closes automatically when `dev` is promoted to `main` (closing keywords only act on the default branch) |

The sync never removes `status:in-progress`, `status:review` or `status:in-dev`, does not add `status:ready`
while either is present, and adds no status labels to closed issues. The
`github-backlog-workflow` skill (`.claude/skills/`) is what sets and clears the two
agent-owned labels as a ticket moves through the workflow below.

## Rules for a ticket to carry `agent-ready`

1. Acceptance criteria are observable (a test or a command can assert them; "a reviewer confirms"
   is not an acceptance criterion — put that in Notes for agents).
2. Verification lists the commands to run.
3. Files section names the entry points.
4. Dependencies are listed and either closed or clearly stubbed around.
5. Size is S or M. L tickets must be split before they are agent-ready.

## Working a ticket (for agents)

1. `gh issue view <n>` and read the linked docs sections. Add `status:in-progress`.
2. Create a branch `<id-lowercase>/<slug>` from `dev` (`git checkout dev && git pull`).
3. Write the failing test(s) that encode the acceptance criteria first; run them; watch them fail.
4. Implement until green. Keep the hooks happy (`.claude/hooks/`); see [CONTRIBUTING.md](../CONTRIBUTING.md).
5. `pnpm verify` (typecheck + tests + python tests) must pass.
6. Open a PR **into `dev`** titled `<id>: <title>` with `Closes #<n>`. Fill the PR template. Swap `status:in-progress` for `status:review`.
7. After the squash-merge into `dev`, swap `status:review` for `status:in-dev`. The issue closes when the next `chore(release)` promotion lands on `main`.
7. Tick the acceptance boxes in the PR description; leave a short "how I verified" note.
