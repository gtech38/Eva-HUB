<!-- Title: <BACKLOG-ID>: <ticket title> -->

Closes #

## What changed

<!-- 2–5 bullets. Link docs sections you updated. -->

## Acceptance criteria

<!-- Copy the ticket's checkboxes and tick the ones this PR satisfies. -->
- [ ]

## How I verified

```bash
pnpm verify
# plus the ticket's Verification commands:
```

<!-- Paste the relevant tail of the output. -->

## Checklist

- [ ] Failing tests were written first; each acceptance criterion has a test
- [ ] Every new/changed query is tenant-scoped (eventId/studioId); every mutation checks `can()`
- [ ] New external service is behind an interface with a console/fake implementation
- [ ] No `TDD_GATE=off`, no `tdd-exempt` added without a reason
- [ ] Contracts changed (job payloads, derivatives JSON, `/embed-selfie`, schema)? docs/ and `.claude/skills/` updated
- [ ] Follow-ups filed as `backlog/*.md` tickets, not TODO comments
