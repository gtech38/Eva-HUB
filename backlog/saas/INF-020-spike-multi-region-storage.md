---
id: INF-020
title: Spike: multi-region storage option for originals and derivatives
labels: [type:spike, area:infra, priority:p3, size:S]
milestone: Phase 3 — SaaS readiness
depends_on: [SHR-008]
epic: EPIC-SAAS
---

## Context
docs/04 Phase 3 lists "Multi-region storage option" among SaaS items; studios outside the US (Indian weddings shot in India) would download 30 GB zips across an ocean. Decide whether per-studio bucket region is worth the complexity.

## Scope
- Evaluate: R2 location hints + Cloudflare CDN (single bucket, edge cache) vs per-studio bucket/region (`Studio.storageRegion`, key layout unchanged, `storage.ts` client per studio) vs replication rules; measure a 2 GB zip download from US-East and ap-south with each option (document method).
- Cost model for egress/replication at 1 TB/month.
- Impact on `BUILD_ZIP`, presign (`S3_PUBLIC_ENDPOINT` per studio), CDN prefix (SHR-008), backups (DOC-003).
- Output: ADR with decision and, if "do it", follow-up tickets.

## Out of scope
- Implementation.

## Acceptance criteria
- [ ] ADR committed with measurements and a decision.

## Files
- `docs/adr/`, `packages/shared/src/storage.ts` (read)

## Verification
ADR reviewed by the studio owner.

## Notes for agents
Time-box one day. Prefer the simplest option that meets a stated latency target.
