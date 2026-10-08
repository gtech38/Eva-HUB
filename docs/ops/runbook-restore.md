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
  - **B. Logical dump.** Use it when the provider or account is unavailable. RPO is up to 24 h, because you restore the latest `backup/pg/<date>.dump` taken before *T*.

## 1. Freeze writes (≈ 5 min)

- [ ] Stop the worker so no jobs run against either database.
- [ ] Put web and admin into maintenance: scale to zero, or route to a static "back soon" page at the proxy (Caddy/Traefik). Every service reads the same `DATABASE_URL`, so leaving any one running keeps writing to the damaged instance.
- [ ] Record the current `DATABASE_URL` (the old instance) in the incident note. Don't delete it.

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
   aws s3 cp s3://hub-media/backup/pg/<date>.dump ./restore/hub.dump        # add --endpoint-url for R2/B2
   aws s3 cp s3://hub-media/backup/pg/<date>.dump.manifest ./restore/hub.dump.manifest
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
  cd packages/db && DATABASE_URL="$NEW_URL" pnpm exec prisma migrate status
  ```

  If *T* is before a migration that the deployed code needs, either run `prisma migrate deploy`, or deploy the app version that matches *T*. Never run `migrate dev` or `reset` against it.
- [ ] **Row counts and checksums.**
  - Path B: take a manifest of the new instance and compare it with the dump's manifest. No difference is allowed.

    ```bash
    DATABASE_URL="$NEW_URL" ./scripts/backup-db.sh ./restore/verify.dump
    diff <(sort ./restore/hub.dump.manifest) <(sort ./restore/verify.dump.manifest) && echo IDENTICAL
    ```

  - Path A: there is no manifest for an arbitrary *T*. Take one of the new instance anyway, and sanity-check `Event`, `Guest`, `Rsvp`, `Photo`, `Order` against what you expect: yesterday's dump manifest, plus what the hosts told you.
- [ ] **Spot-check** the specific records the incident was about. For example, the event whose guests were deleted.

## 4. Re-point `DATABASE_URL` (≈ 10 min)

- [ ] Update the `DATABASE_URL` secret for **web, admin and the worker**. If you use a pooler, update the pooler URL too. All three must point at `NEW_URL`; a split brain is worse than downtime.
- [ ] Redeploy or restart all three. Prisma reads the URL at start; the worker reads it at start.
- [ ] Leave the old instance running, read-only, and untouched (step 9).

## 5. Verify the service (≈ 10 min)

- [ ] Web health: `curl -fsS https://<ROOT_DOMAIN>/api/health` returns `{"ok":true}`.
- [ ] Worker health: `curl -fsS http://<worker-host>:8010/health` returns `"ok": true`.
- [ ] When INF-014 (#79) lands, `/api/health` on web, admin and worker also reports DB and S3 reachability. Use those and expect `db: ok`.
- [ ] Admin: the jobs page loads. Stale `RUNNING` jobs from before *T* are released by the worker (`requeue_stale`) and retried.
- [ ] **Smoke e2e.** When the Playwright suites exist (WEB-001 #89, ADM-001 #81 on the harness from #86), run them against the restored environment. Until then, check by hand:
  1. Sign in to admin with a magic link.
  2. Open an event in admin.
  3. Open that event's guest site.
  4. Submit an RSVP as an invited guest.
  5. Open the gallery and one photo. The original is a presigned GET.
  6. Send one test email.

## 6. Re-apply deletions and purges that happened after *T*

A restore to *T* brings back everything deleted after *T*. That includes **biometric data** and
the audit rows that recorded its deletion ([backups.md §7](backups.md#7-biometric-data-in-backups-cubi-destruction-timeline)).

- [ ] **Event face-index purges that are due** (`faceIndexPurgeAt` passed, but no purge recorded in the restored DB). Run this SQL; the worker's `PURGE_FACE_INDEX` handler deletes `Face`/`FaceCluster` and writes `faceindex.purge`:

  ```sql
  INSERT INTO "Job" (type, payload, "dedupeKey")
  SELECT 'PURGE_FACE_INDEX', jsonb_build_object('eventId', id), 'purge-face:' || id || ':restore'
  FROM "Event"
  WHERE "faceIndexPurgeAt" <= now() AND "faceIndexPurgedAt" IS NULL
  ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'QUEUED', "runAt" = now(), attempts = 0;
  ```

- [ ] **Face profiles past `purgeAfter`.** Delete them (or let the scheduled purge, WRK-012, do it), then check: `SELECT count(*) FROM "FaceProfile" WHERE "purgeAfter" <= now()` must be 0.
- [ ] **Per-person deletions after *T*** (profile revokes, "remove me" opt-outs, DSAR deletions). These can only be replayed from a record kept outside this database, and that doesn't exist yet (LEG-008). Until it does, list them from the confirmation emails or tickets you have, and re-apply each one by hand following `docs/compliance/runbook-biometric-deletion.md` (LEG-005).
- [ ] **Bucket orphans.** Originals uploaded after *T* exist in the bucket but have no `Photo` row. List them and decide with the studio whether to re-import. Deletions made after *T* left `Photo` rows pointing at deleted objects; restore those objects from versioning (below) or delete the rows. The tooling for this is WRK-005.

## 7. Unfreeze

- [ ] Remove the maintenance page and start the worker.
- [ ] Watch errors and job failures for an hour.
- [ ] Tell affected studios what *T* was and what they need to redo (RSVPs and uploads after *T*).

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

- [ ] Keep the old instance for **at most 7 days**, for investigation, then delete it. It contains embeddings that may already have been purged from the live data, and §7 of backups.md budgets their lifetime.
- [ ] Delete local copies of dumps (`./restore/`).
- [ ] Record in the incident note, and copy the timings to [backups.md §8](backups.md#8-the-restore-drill-scriptsrestore-drillsh):
  - *T*, and the path taken;
  - the time for each step;
  - the total time against the 2-hour RTO;
  - the data lost against the 15-minute RPO;
  - follow-ups.
