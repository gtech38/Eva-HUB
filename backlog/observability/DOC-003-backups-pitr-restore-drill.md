---
id: DOC-003
title: Postgres backups, PITR, bucket versioning and a restore drill script
labels: [type:chore, area:docs, area:infra, area:db, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-OBS
---

## Context
docs/01 §10: "Backups: daily Postgres backups with point-in-time recovery from the managed provider. Bucket versioning is on for originals." Nothing is written down and no restore has been attempted. Originals are irreplaceable; the face index is reproducible; guest lists and RSVPs are not.

## Scope
- `docs/ops/backups.md`: what to back up (Postgres, bucket originals; derivatives/zips reproducible), RPO/RTO targets (RPO 15 min via PITR, RTO 2 h), managed-Postgres PITR settings per candidate provider (Neon, Supabase, RDS, Crunchy — generic), bucket versioning + lifecycle (keep noncurrent originals 90 d; expire `d/` and `zip/` noncurrent after 7 d), `pg_dump` logical backup as a second copy to the bucket (`backup/pg/<date>.dump`), encryption and retention, who has access.
- `scripts/backup-db.sh` (`pg_dump -Fc` to a file and optional upload with `aws s3 cp` to the configured bucket) and `scripts/restore-drill.sh` (spins up a throwaway Postgres container, restores the dump, runs `prisma migrate status`, counts rows in `Event/Guest/Photo`, prints timings, tears down).
- Worker-side: nothing. Make the drill runnable locally against the compose DB so it is exercised in CI weekly (`.github/workflows/restore-drill.yml`, `schedule`).
- `docs/ops/runbook-restore.md`: step-by-step restore to a new provider instance, re-pointing `DATABASE_URL`, verifying with the health endpoints and a smoke e2e.

## Out of scope
- Choosing the provider (DOC-006). Bucket replication across regions (SAAS multi-region).

## Acceptance criteria
- [ ] `scripts/restore-drill.sh` completes locally in under 5 minutes on the seeded DB and prints row counts matching the source.
- [ ] Weekly CI drill workflow exists and passes once.
- [ ] Docs name RPO/RTO and the lifecycle rules with exact JSON for S3 and R2.

## Files
- `docs/ops/{backups.md,runbook-restore.md}`, `scripts/{backup-db.sh,restore-drill.sh}`, `.github/workflows/restore-drill.yml` (new)

## Verification
```bash
./scripts/backup-db.sh /tmp/hub.dump && ./scripts/restore-drill.sh /tmp/hub.dump
```

## Notes for agents
Treat the drill script as the test: it must fail non-zero when counts differ. Use `pgvector/pgvector:pg16` for the throwaway container so the `vector` type restores.
