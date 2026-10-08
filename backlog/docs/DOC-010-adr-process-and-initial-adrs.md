---
id: DOC-010
title: ADR process and initial ADRs (queue, storage, tenancy, face model, local S3, messaging path)
labels: [type:chore, area:docs, priority:p1, size:M, agent-ready]
milestone: Phase 0 — Foundations
epic: EPIC-DOCS
---

## Context
Several tickets (WRK-008, SHR-005, WEB-025, INF-020) say "record as an ADR" and there is no ADR directory or template. Decisions already made in docs/01 and in code need a home that later agents can cite.

## Scope
- `docs/adr/README.md` (process: when to write one, numbering, statuses Proposed/Accepted/Superseded, review in PR) and `docs/adr/0000-template.md` (Context, Decision, Consequences, Alternatives, References).
- Initial ADRs, each ≤ 1 page, grounded in the code:
  - 0001 Postgres `Job` table with `FOR UPDATE SKIP LOCKED` instead of Redis/SQS (`packages/db/src/index.ts`, `workers/media/hub_worker/jobs.py`).
  - 0002 S3 API only for storage; R2 recommended; key layout `s/{studioId}/e/{eventId}/...` (`packages/shared/src/storage.ts`).
  - 0003 Studio → Event tenancy with `studioId` on tenant rows; RLS deferred to Phase 3 (`schema.prisma`).
  - 0004 YuNet + SFace (OpenCV Zoo, MIT/Apache) over InsightFace weights; `modelVersion` on embeddings; revisit after WRK-008.
  - 0005 RustFS locally because MinIO images were withdrawn (`infra/docker-compose.yml` comment).
  - 0006 Self-built session/magic-link auth instead of Better Auth for the POC; criteria to switch (`packages/shared/src/auth.ts` header comment).
  - 0007 Separate `apps/admin` from `apps/web` (hostname routing simplicity, independent deploy).
  - 0008 Worker → admin internal HTTP endpoint for message sending (SHR-005) — status Proposed until that ticket merges.
- `scripts/adr-new.mjs <title>` creating the next-numbered file from the template.
- Link ADR index from `README.md` and `CLAUDE.md`.

## Out of scope
- Decisions not yet made (payout destination WEB-025, multi-region INF-020) — those tickets create their own.

## Acceptance criteria
- [ ] Eight ADR files plus template and README exist; `node scripts/adr-new.mjs test` creates `0009-test.md` (delete after).
- [ ] Each ADR cites at least one file path that implements it.
- [ ] `README.md` links the index.

## Files
- `docs/adr/*.md`, `scripts/adr-new.mjs` (new), `README.md`, `CLAUDE.md`

## Verification
```bash
ls docs/adr && node scripts/adr-new.mjs smoke && rm docs/adr/0009-smoke.md
```

## Notes for agents
Keep ADRs factual about what the code does today; use Consequences to list the tickets that follow from each decision.
