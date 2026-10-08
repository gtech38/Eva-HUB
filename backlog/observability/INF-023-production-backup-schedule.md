---
id: INF-021
title: Production backup schedule, least-privilege backup credentials and quarterly real-size restore drill
labels: [type:chore, area:infra, area:db, priority:p1, size:S]
milestone: Phase 1 — MVP
depends_on: [DOC-003, DOC-006]
epic: EPIC-OBS
---

## Context
DOC-003 shipped `scripts/backup-db.sh`, `scripts/restore-drill.sh`, a weekly CI drill against a seeded database, and docs/ops/backups.md. Nothing runs the logical backup in production yet, the IAM/token split in backups.md §6 isn't applied anywhere, and no drill has run against a real-size backup. So the 2-hour RTO is unmeasured. All of this depends on the provider chosen in DOC-006.

## Scope
- **Daily schedule.** Run `scripts/backup-db.sh <tmp> --upload` daily from the deploy environment, for example a cron container in the compose-prod stack (INF-018) or a scheduled job holding the production secrets. On failure, alert via the error tracker (INF-014).
- **Credentials.** The backup writer can only `PutObject` under `backup/pg/` (on R2, in a separate `hub-backups` bucket). The app runtime key gets an explicit deny on `backup/*`. Use a read-only Postgres role for `pg_dump` (`pg_read_all_data`).
- **Encryption.** Optional client-side encryption of the dump before upload (`age` with an offline recipient). If adopted, `restore-drill.sh` takes the identity file.
- **Bucket configuration.** Apply the bucket versioning and lifecycle JSON from docs/ops/backups.md §5 to the production bucket(s), and record the CLI output.
- **Quarterly drill.** Download the latest dump plus manifest, run `restore-drill.sh`, and record the timings in docs/ops/backups.md §8.

## Out of scope
- Choosing the provider (DOC-006). Multi-region replication (SAAS).

## Acceptance criteria
- [ ] A backup object for each of the last 3 days exists under `backup/pg/` in production.
- [ ] The app runtime credentials get AccessDenied when reading `backup/pg/` (command output pasted in the PR).
- [ ] One real-size restore drill has passed, and its timings are recorded in docs/ops/backups.md §8.

## Files
- `infra/` (compose-prod cron or equivalent), `docs/ops/backups.md`, `docs/ops/runbook-restore.md`

## Verification
```bash
aws s3 ls s3://<bucket>/backup/pg/ | tail -3
./scripts/restore-drill.sh ./latest.dump
```

## Notes for agents
Needs production access, so this ticket is not agent-ready. Never put production dumps in the repo, in CI artifacts or in tickets.
