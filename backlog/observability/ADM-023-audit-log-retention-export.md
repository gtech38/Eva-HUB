---
id: ADM-023
title: Audit log retention policy and export
labels: [type:feature, area:admin, area:worker, priority:p2, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [ADM-003, WRK-012]
epic: EPIC-OBS
---

## Context
`AuditLog` grows without bound (face searches, downloads, favorites) and is only browsable on `/platform/audit`. CUBI compliance (LEG-005) needs consent and purge events kept for years, while download/view noise can be summarised. Studios need an export for disputes ("who hid this photo").

## Scope
- Retention classes by `action` prefix: `consent.*`, `faceindex.*`, `faceprofile.*`, `user.merge`, `dsar.*`, `entitlement.*`, `order.*` → keep 7 years; `photo.download`, `face.search`, `favorite.*`, `auth.*` → 400 days; everything else 3 years. Daily job `COMPACT_AUDIT` (scheduled by WRK-012's tick): deletes expired rows after writing a monthly summary row (`audit.compact` with counts per action) so totals survive.
- Export: `/studios/[studioId]/audit` (owner) with filters (event, action prefix, date range, actor) and CSV/JSONL export route; platform page gains the same filters; audited `audit.export`.
- Indexes: `@@index([eventId, createdAt])`, `@@index([action, createdAt])` + migration.
- Tests: retention classifier; compaction deletes only expired rows and writes the summary; export respects studio scope.

## Out of scope
- Shipping audit logs to a SIEM (log pipeline).

## Acceptance criteria
- [ ] `retentionFor("consent.grant")` = 7 y, `retentionFor("photo.download")` = 400 d (unit).
- [ ] Compaction on fixture rows removes the 2-year-old download rows, keeps the 2-year-old consent rows, writes one summary (pytest).
- [ ] Studio A export never contains studio B rows (vitest with Postgres).

## Files
- `packages/shared/src/audit-retention.ts` + test (new), `workers/media/hub_worker/handlers/compact_audit.py` (new), `workers/media/hub_worker/scheduler.py`, `workers/media/tests/test_compact_audit.py`
- `apps/admin/src/app/studios/[studioId]/audit/{page.tsx,export/route.ts}` (new), `apps/admin/src/app/platform/audit/page.tsx`, `packages/db/prisma/schema.prisma` + migration

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
cd workers/media && make test -- -k compact
```

## Notes for agents
First failing test: retention classifier. The classifier is the single source of truth: Python reads the same table exported as JSON (`packages/shared/src/audit-retention.json`) to avoid drift.
