---
id: LEG-008
title: Deletion ledger outside the primary database so post-restore biometric and DSAR deletions can be replayed
labels: [type:feature, area:legal, area:shared, area:db, priority:p1, size:M]
milestone: Phase 1 — MVP
depends_on: [DOC-003, LEG-007]
epic: EPIC-LEGAL
---

## Context
docs/ops/backups.md §7 (DOC-003): a restore to time *T* brings back every embedding purged after *T*, and rolls back the `AuditLog` rows that recorded the purge. Only purges that are *due by date* can be found from the restored data (`faceIndexPurgeAt`). Everything else made after *T* is invisible in the restored database:
- event-level actions: `faceindex.purge`, `faceindex.purge.request` ("Purge now"), `event.facesearch.disable`/`enable`, and `photo.delete` (whose cascade removes `Face` and `PhotoMatch`);
- per-person deletions: `FaceProfile` revokes, "remove me" opt-outs (WEB-021) and DSAR deletions (LEG-007).

DOC-003 replays the event-level actions from the **old** instance's `AuditLog` (`docs/ops/replay-export.sql` + `docs/ops/replay-after-restore.sql`). That only works while the old instance survives, which is why the post-restore bound in backups.md §7 is best effort. Per-person deletions have no replayable record at all. Under CUBI, a restore must not quietly undo a destruction.

## Scope
- On every person-level deletion (`faceprofile.revoke`, `faceSearchOptOut`, `dsar.completed`, `PhotoMatch` deletions on request) **and** every event-level action the DOC-003 replay covers (`faceindex.purge`, `faceindex.purge.request`, `event.facesearch.disable`/`enable`, `photo.delete`), append a minimal record to a store outside the primary Postgres. The record holds the action, subject ids, time and actor, and **no biometric data**. The store could be an append-only object under `ledger/` in the bucket, or the logging backend with long retention; decide in this ticket.
- `scripts/compliance/replay-deletions.mjs --since <T>`: reads the ledger and re-applies each deletion idempotently against `DATABASE_URL`. It prints PASS/FAIL per record.
- Add the replay to docs/ops/runbook-restore.md step 6, and to `docs/compliance/runbook-biometric-deletion.md` (LEG-005).
- Replace the old-instance dependency: the ledger replay covers what `docs/ops/replay-after-restore.sql` does today plus the per-person actions, so the post-restore bound in docs/ops/backups.md §7 stops being best effort. Keep the action names in `scripts/tests/test_restore_contracts.py` in sync.

## Out of scope
- Purges that are due by date: the runbook's step 6c re-queues them from `faceIndexPurgeAt`, which survives in the restored data.

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
