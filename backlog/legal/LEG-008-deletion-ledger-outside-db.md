---
id: LEG-008
title: Deletion ledger outside the primary database so post-restore biometric and DSAR deletions can be replayed
labels: [type:feature, area:legal, area:shared, area:db, priority:p1, size:M]
milestone: Phase 1 — MVP
depends_on: [DOC-003, LEG-007]
epic: EPIC-LEGAL
---

## Context
docs/ops/backups.md §7 (DOC-003): a restore to time *T* brings back every embedding purged after *T*. The restore runbook (step 6) re-runs event purges that are due, because `faceIndexPurgeAt` is in the data. But per-person deletions made after *T* leave no trace in the restored database, because their `AuditLog` rows are rolled back too. Those are `FaceProfile` revokes, "remove me" opt-outs (WEB-021) and DSAR deletions (LEG-007). Under CUBI, a restore must not quietly undo a destruction.

## Scope
- On every person-level deletion (`faceprofile.revoke`, `faceSearchOptOut`, `dsar.completed`, `PhotoMatch` deletions on request), append a minimal record to a store outside the primary Postgres. The record holds the action, subject ids, time and actor, and **no biometric data**. The store could be an append-only object under `ledger/` in the bucket, or the logging backend with long retention; decide in this ticket.
- `scripts/compliance/replay-deletions.mjs --since <T>`: reads the ledger and re-applies each deletion idempotently against `DATABASE_URL`. It prints PASS/FAIL per record.
- Add the replay to docs/ops/runbook-restore.md step 6, and to `docs/compliance/runbook-biometric-deletion.md` (LEG-005).
- Today the runbook replays only event-level actions (`faceindex.purge`, `faceindex.purge.request`, `event.facesearch.disable`/`enable`) from the **old instance's** `AuditLog` via `docs/ops/replay-after-restore.sql` (DOC-003). Extend that file, or replace it with the ledger replay, for the per-person actions, so the post-restore bound in docs/ops/backups.md §7 stops being best effort.

## Out of scope
- Event-level purges, which are already recomputable from `faceIndexPurgeAt`.

## Acceptance criteria
- [ ] Revoking a face profile writes a ledger record (vitest).
- [ ] After restoring a dump taken before the revoke, `replay-deletions.mjs --since <dump time>` deletes the profile again and reports PASS (vitest with Postgres, using `scripts/backup-db.sh` and `scripts/restore-drill.sh` patterns for the scratch DB).
- [ ] Ledger records contain no `embedding` field (unit test).

## Files
- `packages/shared/src/` (ledger writer behind an interface with a fake), `scripts/compliance/replay-deletions.mjs` (new), `docs/ops/runbook-restore.md`

## Verification
```bash
pnpm test
node scripts/compliance/replay-deletions.mjs --since 2026-01-01T00:00:00Z --dry-run
```

## Notes for agents
Counsel input (LEG-006) may change which actions must be replayed; mark open questions `[COUNSEL]`. Not agent-ready until LEG-007 defines the deletion semantics.
