---
id: EPIC-DOCS
title: Documentation, ADRs and onboarding
labels: [type:epic, area:docs, priority:p1, size:L]
milestone: Phase 0 — Foundations
---

## Context
The planning docs (`docs/01–04`) were written before the code and have drifted: §11 proposes `apps/web` only, but `apps/admin` exists; "two deployable services" is now three; the storage adapter has no multipart; auth is self-built rather than Better Auth; `docs/schema.draft.prisma` is superseded by `packages/db/prisma/schema.prisma`. Decisions (Postgres queue, S3-only, Studio→Event, SFace licence, RustFS instead of MinIO, worker→internal-endpoint messaging) are recorded only in prose or commit messages. New agents start from `CLAUDE.md` and need contracts for job payloads and `/embed-selfie`.

## Children
- DOC-010 ADR process and initial ADRs
- DOC-012 Architecture docs and README refresh to match the code
- DOC-013 Contract docs for job payloads and the worker HTTP API
- DOC-014 Onboarding guide for new agents and developers

## Definition of Done
- [ ] Every architectural decision referenced by a ticket in this backlog has an ADR.
- [ ] `docs/01-architecture.md` and `README.md` describe the three services and the actual repo layout.
- [ ] Job payload and HTTP contracts are documented and validated by tests on both sides.
- [ ] A new developer reaches a running stack and a passing `pnpm verify` using only the onboarding guide.
