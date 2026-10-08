---
id: DOC-006
title: Provider-agnostic deployment guide with CDN rules and migration/rollout runbook
labels: [type:chore, area:docs, area:infra, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-018, DOC-005, SHR-008]
epic: EPIC-DEPLOY
---

## Context
docs/01 §2 says it "runs on Fly, Railway, Render, ECS, Cloud Run, Hetzner + Coolify, or a bare VPS" and recommends R2. No provider has been chosen. The guide must let one person deploy to any of them in an afternoon, and must say how migrations ship safely (`prisma migrate deploy` is not run in images per INF-015).

## Scope
- `docs/deploy/README.md`: topology (Caddy → web/admin, worker private, managed Postgres with pgvector, R2 bucket + custom domain for `PUBLIC_DERIVATIVE_BASE_URL`), sizing for a single studio (2 vCPU web/admin, 4 vCPU worker), steps per path: (a) VPS with docker compose (INF-018), (b) PaaS (Fly/Railway generic: one app per image, private networking, env from DOC-005, volumes none), (c) managed Postgres enabling `vector`/`citext` extensions; R2 setup (bucket, CORS from SHR-007, custom domain, cache rules), CDN cache rules for `d/*/thumb-*` and `webWm-*` (long TTL, ignore query), never caching HTML (`Cache-Control: private, no-store` already set) and never caching `orig/` or `web-` clean images.
- `docs/ops/runbook-rollout.md`: release = tag → images with `GIT_SHA` → run `prisma migrate deploy` from a one-off container **before** starting the new web/admin (expand/contract pattern: additive migrations first, destructive in a later release), start worker last, verify health + `infra/smoke.sh`, rollback = previous image tag + (only if needed) `prisma migrate resolve --rolled-back`; checklist for data migrations (backfills as idempotent scripts); maintenance mode via Caddy `respond 503` snippet.
- `docs/ops/runbook-incidents.md` (short): worker down, queue stuck (`requeue_stale`), S3 unreachable, certificate renewal failure, Stripe webhook backlog (replay from dashboard), how to read logs (SHR-015) and the error tracker (INF-014).
- Link the ADRs (DOC-010) for the storage/queue decisions.

## Out of scope
- Terraform/IaC. Multi-region.

## Acceptance criteria
- [ ] A reviewer follows the VPS path on a fresh VM and reaches a working sign-in gate over TLS; the PR records the time taken and any doc fixes.
- [ ] The rollout runbook is exercised once on staging with a real migration (DB-001 or later) and the result noted.
- [ ] Every command in the docs is copy-pasteable (no `<placeholders>` without a definition in DOC-005).

## Files
- `docs/deploy/{README.md,cdn.md,storage.md}`, `docs/ops/{runbook-rollout.md,runbook-incidents.md}` (new or extended), `README.md` (link)

## Verification
Manual walkthrough; `markdownlint docs/` if configured; `node scripts/env-docs.mjs --check` still passes.

## Notes for agents
Write the runbook as numbered steps with expected output after each. Where a provider differs, use a short per-provider subsection rather than hedging prose.
