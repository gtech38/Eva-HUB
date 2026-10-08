# Backlog as code

Every GitHub issue for this repo is authored here first as one markdown file, then synced to
GitHub with `pnpm backlog:sync`. The file is the source of truth; edit it and re-sync rather
than editing the issue on GitHub (the sync overwrites title, body, labels and milestone, and
is idempotent — it matches issues by the `<!-- backlog:<id> -->` marker in the body).

## File format

`backlog/<epic>/<id>-<slug>.md`

```markdown
---
id: WEB-012                      # stable, never reused
title: Guardian face search for child guests
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [WEB-010, WORKER-004] # ids; sync adds "Blocked by #n" lines and status:blocked
epic: EPIC-FACE                   # id of the umbrella issue
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

## Rules for a ticket to carry `agent-ready`

1. Acceptance criteria are observable (a test can assert them).
2. Verification lists the commands to run.
3. Files section names the entry points.
4. Dependencies are listed and either closed or clearly stubbed around.
5. Size is S or M. L tickets must be split before they are agent-ready.

## Working a ticket (for agents)

1. `gh issue view <n>` and read the linked docs sections.
2. Create a branch `<id-lowercase>/<slug>` from `main`.
3. Write the failing test(s) that encode the acceptance criteria first; run them; watch them fail.
4. Implement until green. Keep the hooks happy (`.claude/hooks/`).
5. `pnpm verify` (typecheck + tests + python tests) must pass.
6. Open a PR titled `<id>: <title>` with `Closes #<n>`. Fill the PR template.
7. Tick the acceptance boxes in the PR description; leave a short "how I verified" note.
