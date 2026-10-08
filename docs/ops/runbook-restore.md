# Runbook: restore Postgres to a new instance

For a real incident: a bad migration, mass deletion, corruption, or a lost provider. Background,
targets and retention are in [backups.md](backups.md). Target: serving again within **2 hours**
(RTO), losing at most **15 minutes** of data (RPO).

Never restore **in place**. Always restore into a new instance, verify it, then switch
`DATABASE_URL`. The old instance is the evidence and the way back.

Keep a timestamped log of every step in the incident note. The timings go into
[backups.md §8](backups.md#8-the-restore-drill-scriptsrestore-drillsh).

## 0. Decide

- [ ] **Pick the restore point *T*** (UTC): the last moment before the damage. To find it, use the deploy time of the bad migration, the first error in the logs, or the `AuditLog.createdAt` of the destructive action.
- [ ] **Pick the path:**
  - **A. Provider PITR.** The default. RPO is minutes.
  - **B. Logical dump.** Use it when the provider or account is unavailable. RPO is up to 24 h, because you restore the latest `backup/pg/<timestamp>.dump` taken before *T*.

## 1. Freeze writes (≈ 5 min)

- [ ] Stop the worker so no jobs run against either database. **It stays stopped until step 7**: the restored `Job`, `ReminderRule` and opt-out state is *T*'s, and a worker that starts early re-sends messages and re-runs work.
- [ ] Put web and admin into maintenance: scale to zero, or route to a static "back soon" page at the proxy (Caddy/Traefik). Every service reads the same `DATABASE_URL`, so leaving any one running keeps writing to the damaged instance.
- [ ] Record the current `DATABASE_URL` (the old instance) in the incident note as `OLD_URL`. Don't delete the instance: step 6c replays from its `AuditLog`. Run every command below from the repo root.

## 2A. Restore with provider PITR (≈ 15–60 min, provider-dependent)

- [ ] Create a **new** instance, branch or project restored to *T*. The menu names differ by provider; the mapping is in [backups.md §3](backups.md#3-managed-postgres-pitr-generic-per-candidate-provider):
  - Neon: create a branch at a timestamp.
  - Supabase: restore to a new project.
  - RDS: restore to point in time.
  - Crunchy: fork at a point in time.
- [ ] Use the same Postgres major version, the same region, and `vector` available.
- [ ] Note the new connection string as `NEW_URL`, with `sslmode=require`.

## 2B. Restore from the logical dump (≈ 15–45 min)

1. Provision a new Postgres 16+ instance with pgvector, anywhere. Note `NEW_URL`.
2. Download the dump and its manifest. You need platform-admin credentials for `backup/`.

   ```bash
   umask 077                                                             # everything below is readable by you only
   mkdir -p ./restore
   aws s3 ls s3://hub-media/backup/pg/                                   # pick a <timestamp>.dump that has its .manifest: the manifest is uploaded last
   aws s3 cp s3://hub-media/backup/pg/<timestamp>.dump ./restore/hub.dump        # add --endpoint-url for R2/B2
   aws s3 cp s3://hub-media/backup/pg/<timestamp>.dump.manifest ./restore/hub.dump.manifest
   ```

3. Prove the dump is good before touching `NEW_URL`. This restores a throwaway copy and checks every table against the manifest:

   ```bash
   ./scripts/restore-drill.sh ./restore/hub.dump
   ```

4. Restore into the new instance. `-j` parallelises the restore; drop it if the instance is small.

   ```bash
   psql "$NEW_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector'
   pg_restore --dbname="$NEW_URL" --no-owner --no-privileges --exit-on-error -j 4 ./restore/hub.dump
   ```

## 3. Verify the data (≈ 5 min)

- [ ] **Migrations line up with the code you're going to run:**

  ```bash
  (cd packages/db && DATABASE_URL="$NEW_URL" pnpm exec prisma migrate status)   # subshell: you stay at the repo root
  ```

  If *T* is before a migration that the deployed code needs, either run `prisma migrate deploy`, or deploy the app version that matches *T*. Never run `migrate dev` or `reset` against it.
- [ ] **Row counts and checksums.**
  - Path B: take a manifest of the new instance and compare it with the dump's manifest. No difference is allowed.

    ```bash
    umask 077; mkdir -p ./restore
    DATABASE_URL="$NEW_URL" ./scripts/backup-db.sh ./restore/verify.dump
    diff <(sort ./restore/hub.dump.manifest) <(sort ./restore/verify.dump.manifest) && echo IDENTICAL
    ```

  - Path A: there is no manifest for an arbitrary *T*. Take one of the new instance anyway (`DATABASE_URL="$NEW_URL" ./scripts/backup-db.sh ./restore/verify.dump`), and sanity-check `Event`, `Guest`, `Rsvp`, `Photo`, `Order` against what you expect: yesterday's dump manifest, plus what the hosts told you.
- [ ] **Spot-check** the specific records the incident was about. For example, the event whose guests were deleted.

## 4. Re-point `DATABASE_URL` (≈ 10 min)

- [ ] Update the `DATABASE_URL` secret for **web, admin and the worker**. If you use a pooler, update the pooler URL too. All three must point at `NEW_URL`; a split brain is worse than downtime.
- [ ] Restart web and admin (still behind the maintenance page). Prisma reads the URL at start. **Do not start the worker yet**; its new `DATABASE_URL` takes effect when it starts in step 7.
- [ ] Leave the old instance running, read-only, and untouched (step 9).

## 5. Verify the service (≈ 10 min)

- [ ] Web is up: `curl -fsS https://<ROOT_DOMAIN>/api/health` returns `{"ok":true}`. **This only proves the process is running; today it does not touch the database.** Prove the database separately:
  - `psql "$NEW_URL" -c 'SELECT count(*) FROM "Event"'` returns the count you saw in step 3;
  - a page that reads the database loads: open an event site and the admin events list.
- [ ] When INF-014 (#79) lands, `/api/health` on web and admin also reports DB and S3 reachability; use it and expect `db: ok`. The worker's `/health` (port 8010) reports its models, not the database, and the worker is not running yet anyway.
- [ ] Admin: the jobs page loads. (Jobs are parked and reviewed later, in step 7.)
- [ ] **Smoke e2e.** When the Playwright suites exist (WEB-001 #89, ADM-001 #81 on the harness from #86), run them against the restored environment. Until then, check by hand:
  1. Sign in to admin with a magic link.
  2. Open an event in admin.
  3. Open that event's guest site.
  4. Submit an RSVP as an invited guest.
  5. Open the gallery and one photo. The original is a presigned GET.
  6. Sending a test email needs the worker: do it in step 7, after it starts.

## 6. Re-apply deletions and purges that happened after *T*

A restore to *T* is a rollback of **everything**, not just the data you were worried about. It
brings back what was deleted after *T*, including **biometric data** and the audit rows that
recorded its deletion ([backups.md §7](backups.md#7-biometric-data-in-backups-cubi-destruction-timeline)).
It also un-does security and consent state, and makes finished work look unfinished. Work through
all of this with the worker still stopped. Run the SQL against `NEW_URL`, ideally in a transaction
you review before committing.

### 6a. Sign-in state: make nobody more signed-in than they were

- [ ] **Sessions.** Sessions revoked or signed out after *T* are back. There is no revocation column to inspect, so end them all; everyone signs in again:

  ```sql
  DELETE FROM "Session";
  ```

- [ ] **One-time sign-in tokens.** Tokens used after *T* are unused again. Burn every outstanding one:

  ```sql
  UPDATE "LoginToken" SET "usedAt" = now() WHERE "usedAt" IS NULL AND "expiresAt" > now();
  ```

- [ ] **Invite links revoked after *T*** (`InviteToken.revokedAt`) work again, and the database cannot say which. Take the list from the incident note, admin audit exports and studio emails. Revoke each by hand. If any revocation was security-driven and you can't enumerate them, revoke every live token and re-send invitations from the admin once the worker is running:

  ```sql
  UPDATE "InviteToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL AND "expiresAt" > now();
  ```

### 6b. Consent and opt-outs

- [ ] **SMS opt-outs** (`ContactPoint.smsOptOut`) recorded after *T* are lost. Re-apply them from the SMS provider's opt-out (STOP) list, which the provider keeps independently of our database. Until that's done, do not start the worker: sending to an opted-out number is a compliance violation (10DLC / TCPA).
- [ ] **Per-person face-search opt-outs and consent revokes after *T*** (`Guest.faceSearchOptOut`, `FaceCluster.suppressed`, `BiometricConsent.revokedAt`, deleted `FaceProfile` rows) are rolled back too. Today no code path writes an audit row for them that the replay in 6c can use (the controls arrive with WEB-006 / WEB-021; photo deletions, by contrast, *are* replayed in 6c), so they can only be re-applied from a record outside this database. That record doesn't exist yet (LEG-008). Until it does, list them from confirmation emails or tickets, and re-apply each by hand following `docs/compliance/runbook-biometric-deletion.md` (LEG-005). This is the gap that makes the post-restore biometric bound best effort (backups.md §7).

### 6c. Biometric purges that are due

- [ ] **Event face-index purges that are due** (`faceIndexPurgeAt` passed, but no purge recorded in the restored DB). This SQL is the worker's `jobs.enqueue` upsert (`workers/media/hub_worker/jobs.py`) in bulk: a `RUNNING` row is never touched, finished or dead rows are reset to `QUEUED` with attempts 0 and no stale lock, error or `finishedAt`, and the payload is refreshed. If `jobs.enqueue` changes, change this copy and `replay-after-restore.sql` with it: `scripts/tests/test_restore_contracts.py` fails until the three are identical, and `test_restore_sql.py` runs this block and the replay against the RUNNING, DEAD and QUEUED branches. The job writes `faceindex.purge` when the worker runs in step 7:

  ```sql
  INSERT INTO "Job" (type, payload, status, "runAt", "maxAttempts", "dedupeKey")
  SELECT 'PURGE_FACE_INDEX', jsonb_build_object('eventId', id), 'QUEUED'::"JobStatus", now(), 5,
         'purge-face:' || id || ':restore'
  FROM "Event"
  WHERE "faceIndexPurgeAt" <= now() AND "faceIndexPurgedAt" IS NULL
  ON CONFLICT ("dedupeKey") DO UPDATE SET
    payload     = EXCLUDED.payload,
    status      = 'QUEUED'::"JobStatus",
    "runAt"     = CASE WHEN "Job".status = 'QUEUED'::"JobStatus"
                       THEN GREATEST("Job"."runAt", EXCLUDED."runAt") ELSE EXCLUDED."runAt" END,
    attempts    = CASE WHEN "Job".status = 'QUEUED'::"JobStatus" THEN "Job".attempts ELSE 0 END,
    "lastError" = NULL,
    "finishedAt" = NULL,
    "lockedBy"  = NULL,
    "lockedAt"  = NULL
  WHERE "Job".status <> 'RUNNING'::"JobStatus";
  ```

- [ ] **Purges, face-search switches and photo deletions made after *T* (replay from the old instance).** The SQL above only finds purges that are due by date. These are all rolled back by the restore, and the restored database has no trace of them:
  - a "Purge now" from the admin;
  - a purge the worker ran after *T*;
  - "face search off" on an event;
  - a deleted photo, whose cascade had removed its `Face` and `PhotoMatch` rows.

  The **old instance's** `AuditLog` still has them (`faceindex.purge`, `faceindex.purge.request`, `event.facesearch.disable` / `enable`, `photo.delete`). That is why step 1 keeps it. [`replay-export.sql`](replay-export.sql) exports those rows from `OLD_URL` in a read-only session. [`replay-after-restore.sql`](replay-after-restore.sql) then re-applies them on `NEW_URL`:
  - sets `faceSearchEnabled` to the last value toggled after *T*;
  - deletes the photos again;
  - parks queued **and** running face-indexing jobs for events purged after *T*;
  - re-queues those purges with the same upsert as above.

  Run the replay once as a dry run that rolls back, review what it would change, then run it again to commit. Both runs are idempotent.

  ```bash
  umask 077; mkdir -p ./restore
  T='2026-10-08T12:00:00Z'   # the restore point from step 0; an offset (+05:30) is fine, no offset means UTC
  PGOPTIONS='-c default_transaction_read_only=on' \
    psql "$OLD_URL" -X -q -v ON_ERROR_STOP=1 -v T="$T" -f docs/ops/replay-export.sql > ./restore/replay-audit.csv
  wc -l ./restore/replay-audit.csv           # note the count in the incident log
  replay() {   # FINISH=ROLLBACK for the dry run, FINISH=COMMIT to apply
    psql "$NEW_URL" -X -v ON_ERROR_STOP=1 -v FINISH="$1" <<'PSQL'
  BEGIN;
  CREATE TEMP TABLE replay_audit (id bigint, action text, "eventId" text, target text, "createdAt" timestamp) ON COMMIT DROP;
  \copy replay_audit FROM './restore/replay-audit.csv' CSV
  \i docs/ops/replay-after-restore.sql
  SELECT id, "faceSearchEnabled" FROM "Event" WHERE id IN (SELECT "eventId" FROM replay_audit);
  SELECT type, status, "dedupeKey", "lastError" FROM "Job" WHERE "dedupeKey" LIKE 'purge-face:%:replay' OR "lastError" LIKE 'parked after restore%';
  :FINISH;
  PSQL
  }
  replay ROLLBACK      # FINISH=ROLLBACK: read the output; nothing is changed
  replay COMMIT        # FINISH=COMMIT: only after the dry run looks right
  ```

  If the old instance is gone or its `AuditLog` is part of the damage, this replay cannot be done. Then the post-restore bound in backups.md §7 is **best effort**: list purges, switches and photo deletions from admin audit exports, studio emails and the incident note, and apply them by hand. LEG-008 removes this dependency on the old instance.

- [ ] **Retention changes after *T*** (`event.retention.change`, `studio.retention.change` in the old `AuditLog`) are not replayed automatically: re-apply each one in the admin (that recomputes `faceIndexPurgeAt`), then re-run the due-purge SQL above.

- [ ] **Face profiles past `purgeAfter`.** Delete them (or let the scheduled purge, WRK-012, do it), then check: `SELECT count(*) FROM "FaceProfile" WHERE "purgeAfter" <= now()` must be 0.

### 6d. Work that already happened must not happen twice

- [ ] **Park jobs that may have already run** between *T* and now. The restored queue is *T*'s: a `SEND_MESSAGE` that went out after *T* is `QUEUED` again and would email or text the same person twice. Park these types, review them on the admin jobs page, and requeue only what is truly pending:

  ```sql
  UPDATE "Job" SET status = 'DEAD'::"JobStatus", "lastError" = 'parked after restore: review before re-running'
  WHERE status IN ('QUEUED'::"JobStatus", 'RUNNING'::"JobStatus")
    AND type IN ('SEND_MESSAGE', 'FIRE_REMINDER', 'PRINT_SUBMIT');
  ```

- [ ] **Reminder rules.** A rule that fired after *T* has `firedAt` empty again and would fire again to every household. Mark everything already due as fired; tell hosts that a reminder due during the outage was skipped, and let them resend:

  ```sql
  UPDATE "ReminderRule" SET "firedAt" = now() WHERE "firedAt" IS NULL AND "sendAt" <= now();
  ```

### 6e. The bucket

- [ ] **Bucket orphans.** Originals uploaded after *T* exist in the bucket but have no `Photo` row. List them and decide with the studio whether to re-import. Deletions made after *T* left `Photo` rows pointing at deleted objects; restore those objects from versioning (below) or delete the rows. The tooling for this is WRK-005.

## 7. Unfreeze

- [ ] Everything in step 6 is ticked. In particular, 6b (opt-outs) is done before any message can be sent.
- [ ] Review the jobs parked in 6c and 6d on the admin jobs page; requeue only what is truly pending.
- [ ] **Start the worker.** It picks up the purge jobs from step 6c. Check `GET http://<worker-host>:8010/health`, and watch the admin jobs page until `PURGE_FACE_INDEX` has succeeded and wrote its `faceindex.purge` audit rows.
- [ ] **Verify the purges, once nothing can re-index those events.** `index_faces.py` does not check `faceIndexPurgedAt`, so a `PROCESS_PHOTO` (which enqueues `INDEX_FACES`) or an `INDEX_FACES` job still pending for a purged event can re-create `Face` rows after its purge. Wait until the first query returns no rows. Then the second must return no rows. If it doesn't, re-run the purge for those events (the 6c replay, or the due-purge SQL) and check again.

  ```sql
  -- 1. indexing still in flight for events purged since the worker started (must be empty before step 2)
  SELECT j.id, j.type, j.status, p."eventId"
  FROM "Job" j
  JOIN "Photo" p ON p.id = j.payload->>'photoId'
  JOIN "Event" e ON e.id = p."eventId"
  WHERE j.type IN ('PROCESS_PHOTO', 'INDEX_FACES')
    AND j.status IN ('QUEUED'::"JobStatus", 'RUNNING'::"JobStatus")
    AND e."faceIndexPurgedAt" > now() - interval '6 hours';

  -- 2. events purged since the worker started that still have Face rows (must be empty)
  SELECT e.id, count(*) AS faces
  FROM "Face" f JOIN "Event" e ON e.id = f."eventId"
  WHERE e."faceIndexPurgedAt" > now() - interval '6 hours'
  GROUP BY e.id;
  ```
- [ ] Send one test email and confirm it arrives (the step 5 smoke test that needs the worker).
- [ ] Remove the maintenance page.
- [ ] Watch errors and job failures for an hour.
- [ ] Tell affected studios what *T* was and what they need to redo (RSVPs and uploads after *T*, reminders skipped, people who must sign in again).

## 8. Restoring objects in the bucket (versioning, S3)

For an original that was overwritten or deleted, within 90 days:

```bash
KEY="s/<studioId>/e/<eventId>/orig/<photoId>.jpg"
aws s3api list-object-versions --bucket hub-media --prefix "$KEY"
# deleted: remove the delete marker, and the previous version becomes current again
aws s3api delete-object --bucket hub-media --key "$KEY" --version-id <DeleteMarkerVersionId>
# overwritten: copy the good version over the current one
aws s3api copy-object --bucket hub-media --key "$KEY" --copy-source "hub-media/$KEY?versionId=<VersionId>"
```

Re-enqueue `PROCESS_PHOTO` for the photo so its derivatives are rebuilt. On R2 there are no
versions; restore from the second copy chosen in DOC-006.

## 9. Close out

- [ ] Keep the old instance for **at most 7 days**, for investigation, then delete it. It contains embeddings that may already have been purged from the live data, and §7 of backups.md budgets their lifetime. Delete it **without** a final snapshot and **without** retaining its automated backups, or the deletion just moves the embeddings somewhere longer-lived:
  - RDS: `aws rds delete-db-instance --db-instance-identifier <old> --skip-final-snapshot --delete-automated-backups`;
  - Neon: delete the old branch (and its history); Supabase: delete the old project; Crunchy: delete the old cluster and confirm no retained backups remain in its console.
- [ ] Delete local copies of dumps and the replay export (`./restore/`).
- [ ] Record in the incident note, and copy the timings to [backups.md §8](backups.md#8-the-restore-drill-scriptsrestore-drillsh):
  - *T*, and the path taken;
  - the time for each step;
  - the total time against the 2-hour RTO;
  - the data lost against the 15-minute RPO;
  - follow-ups.
