---
id: DOC-020
title: Verify and record encryption in transit and at rest, and worker access, per environment
labels: [type:chore, area:docs, area:infra, priority:p2, size:S]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-DEPLOY
---

## Context
Found while writing the LEG-005 compliance checklist (docs/compliance/biometrics.md, row C5 and gap G6). CUBI asks for reasonable care in storing biometric identifiers. In this repo nothing configures encryption: local dev is plain HTTP and plain Postgres, production TLS is planned (INF-018) but the web-to-worker call is internal HTTP, Postgres connections have no `sslmode`, at-rest encryption is a provider feature nobody has checked, and the worker API (`/embed-selfie`) has no authentication and binds `0.0.0.0`, relying on the network keeping it private.

## Decision needed before this is agent-ready
A production provider must be chosen (DOC-006) because the answers differ per provider. Until then this ticket can only produce the checklist template.

## Scope
- A "Data protection" section in the deploy guide (DOC-006) with one table per environment: browser-to-Caddy TLS, Caddy-to-web/admin, web-to-worker, app-to-Postgres (`sslmode=require` or private network), app-to-bucket, Postgres at-rest encryption, bucket at-rest encryption, backup encryption (docs/ops/backups.md §6), with the exact setting or screenshot that proves each and the date it was checked.
- Decide whether the worker needs a shared-secret header on `/embed-selfie` and `/health` in production, or whether network isolation is the accepted control; record the decision. If a header is chosen, file the implementation as its own ticket.
- Update row C5 of docs/compliance/biometrics.md from the filled-in table.

## Out of scope
- Row-level security (DB-004). Key management beyond what the provider offers.

## Acceptance criteria
- [ ] Every row of the table is filled for the first production environment, or marked "not encrypted" with an owner and a date.
- [ ] The worker access decision is written down with its reason.
- [ ] biometrics.md C5 links to the table.

## Files
`docs/deploy/` (from DOC-006), `docs/compliance/biometrics.md`

## Verification
```bash
pnpm backlog:sync --dry-run
```
Plus the commands or screenshots recorded in the table itself.

## Notes for agents
Do not claim a control the provider has not shown you. "Default on" in a vendor's marketing page is not evidence; a console setting or API response is.
