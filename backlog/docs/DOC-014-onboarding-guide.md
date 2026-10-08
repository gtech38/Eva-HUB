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
- [ ] A fresh clone followed step by step reaches a signed-in admin and a READY photo (recorded by the PR author with timings).
- [ ] Every command in the guide is also in `package.json`/Makefile (no undocumented scripts).
- [ ] `CLAUDE.md` links the guide.

## Files
- `docs/onboarding.md`, `docs/onboarding/sample-selfie.jpg` (new), `CLAUDE.md`, `README.md`

## Verification
Manual walkthrough on a clean clone; `grep -c onboarding CLAUDE.md`.

## Notes for agents
Write for someone who has never seen the repo; prefer exact expected output over descriptions.
