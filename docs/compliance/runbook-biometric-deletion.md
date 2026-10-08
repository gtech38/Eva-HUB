# Runbook: biometric data deletion

**Ticket:** LEG-005 · **Companion:** [biometrics.md](biometrics.md) (what the controls are and where they fall short) · **Script:** `scripts/compliance/verify-purge.mjs`

Use this when a studio, host, guest or guardian asks for face data to be deleted, or when a retention
date has passed. It covers the three things that hold biometric data: the **event face index**
(section 1), **one person's data** (section 2) and **backups** (section 3).

Read these first, because they change what you can promise:

- **Nothing purges automatically yet** (WRK-012). Event retention dates are only dates. Every purge
  today is started by a person.
- **There is no self-service** for guests (WEB-021, WEB-006). Requests reach the studio, and an
  operator runs section 2.
- **Deleting from the live database does not delete from backups**, and a restore brings deleted
  data back (section 3).

## 0. Before you start

1. Record who asked, when, for which event or person, and a **ticket id** (never an email address
   or a name) to reference the request. You will put the ticket id in the audit row.
2. Find the database name. **The verify script takes the database name on the command line and has
   no default; it refuses the shared development database `hub` and does not accept names with
   anything but letters, digits and underscores.** It only runs `SELECT`s, in a read-only
   transaction. Host and credentials come from `DATABASE_URL`; the database name does not.
   ```bash
   export DATABASE_URL='postgresql://USER:PASS@HOST:PORT/ANYDB'   # host + credentials only
   node scripts/compliance/verify-purge.mjs <eventId> --database <the real database name>
   ```
   `hub` is the shared development database. The production database must never be named `hub`
   (DOC-020 pins this); if it is, rename it rather than editing the script's refusal, and use the SQL
   in section 1.5 in the meantime.
3. Find the `eventId` (admin event URL, or `SELECT id, slug, title FROM "Event" WHERE slug = '...'`).
4. Check the worker is running (admin `/platform/jobs`). The purge is a worker job.

## 1. Per event: purge the face index

### 1.1 Stop it coming back (do this first if the event is still receiving uploads)

`INDEX_FACES` does not look at `Event.faceIndexPurgedAt`, so any photo uploaded or reprocessed after
the purge is embedded again (biometrics.md G4, WRK-020). Switch face search off first:
admin event **Settings -> "Face search (biometric)" -> untick "Face search enabled for this event" -> Save**. This writes `event.facesearch.disable`
and makes `INDEX_FACES` skip. It does **not** delete anything by itself, and an `INDEX_FACES` job that is
already running can still write faces after the purge commits (biometrics.md L11), so wait for
running jobs to finish before purging; the verify step catches a late write.

### 1.2 Trigger the purge

Admin event **Settings -> "Purge face index now"** (needs `event.settings`: a studio owner or platform admin
who signed in within the last 12 hours). This calls `purgeFaceIndexNow`, which queues a `PURGE_FACE_INDEX {eventId}` job and writes
`AuditLog faceindex.purge.request` with **your user as actor**. (Once WRK-012 ships, the scheduler
queues the same job when `faceIndexPurgeAt` passes; the rest of this section is unchanged.)

### 1.3 Wait for the job

```sql
SELECT id, status, attempts, "lastError"
  FROM "Job" WHERE type = 'PURGE_FACE_INDEX' AND payload->>'eventId' = '<eventId>' ORDER BY id DESC LIMIT 3;
```

`SUCCEEDED` is the goal. A job that failed and will be retried does **not** show `FAILED`: it goes
back to `QUEUED` with `lastError` set and `runAt` in the future (backoff), so read `lastError` and
`runAt`, not just `status`. `QUEUED` with a null `lastError` and a past `runAt` for more than a
minute means no worker is claiming it. `DEAD` means it gave up after its attempts: read `lastError`,
fix the cause, and queue the purge again (section 1.2). Do not edit `Face` rows by hand.

### 1.4 Verify

```bash
node scripts/compliance/verify-purge.mjs <eventId> --database <name>
```

Exit code 0 and `RESULT: PASS` means all of these hold for that event in that database right now:

| Line | Meaning |
|---|---|
| `Face rows` = 0 | no embeddings left for the event |
| `FaceCluster rows` = 0 | no clusters left |
| `Photos still marked as face-indexed` = 0 | `Photo.facesIndexedAt` reset by the handler |
| `Queued or running INDEX_FACES / CLUSTER_FACES / PROCESS_PHOTO jobs` none | nothing is about to rebuild the index (`PROCESS_PHOTO` counts only while face search is on, because it enqueues `INDEX_FACES`) |
| `Event.faceSearchEnabled` (WARN if on) | new uploads would be embedded again; a WARN does not fail the run, but turn it off (1.1) unless the studio wants a new index |
| `Event.faceIndexPurgedAt` set | the handler completed |
| `AuditLog 'faceindex.purge' row` | the worker's own record, with counts and the job id; it must not be older than `faceIndexPurgedAt`, so a row from an earlier purge does not count |
| `DEAD INDEX_FACES / PROCESS_PHOTO jobs` (WARN) | the admin jobs page's "Retry dead" would revive them and rebuild the index; cancel them instead |
| `PhotoMatch` / `BiometricConsent` (INFO) | rows kept on purpose; see biometrics.md |

Exit code 1 means a `FAIL` line: do not report the purge as done. Exit code 2 is a usage error, a
refusal (missing or forbidden database name), or any failure to run the checks at all (cannot
connect, timeout): in that case nothing was verified.

### 1.5 The same checks by hand

```sql
SELECT count(*) FROM "Face"        WHERE "eventId" = '<eventId>';   -- 0
SELECT count(*) FROM "FaceCluster" WHERE "eventId" = '<eventId>';   -- 0
SELECT count(*) FROM "Photo"       WHERE "eventId" = '<eventId>' AND "facesIndexedAt" IS NOT NULL;  -- 0
SELECT "faceIndexPurgeAt", "faceIndexPurgedAt" FROM "Event" WHERE id = '<eventId>';  -- purgedAt not null
```

### 1.6 Locate and keep the evidence

```sql
SELECT id, action, "actorUserId", data, "createdAt"
  FROM "AuditLog"
 WHERE "eventId" = '<eventId>' AND action IN ('faceindex.purge.request', 'faceindex.purge', 'event.facesearch.disable')
 ORDER BY id;
```

Expect `faceindex.purge.request` (actor = who asked) followed by `faceindex.purge` (no actor; `data` =
`{"faces": n, "clusters": n, "photos": n, "jobId": n}`). Export them with `\copy (...) TO 'purge-<eventId>.csv' CSV HEADER`
and attach the CSV and the `verify-purge` output to the request. There is no audit export screen
yet (ADM-023). The request row proves someone asked; only the `faceindex.purge` row plus the verify
output prove it was done.

### 1.7 Close out

Tell the requester: the live face index for the event is deleted; saved photo matches are kept
because they hold no face data (deleted per person on request, section 2); copies in backups expire
on the schedule in `docs/ops/backups.md`. Leave face search off unless the studio wants a new
index; re-enabling does not rebuild one for existing photos, and the gallery "Re-index faces" button
only enqueues `CLUSTER_FACES` (biometrics.md L11).

## 2. Per person (guest, user or child)

For a request from a guest, from a guardian for a child, or from a user who revoked consent. Verify
who is asking first: reply to a verified contact on the account, or confirm with the host. Children:
only a guardian in the child's household may ask. The SQL in this section is run by a platform
operator with database access, never by studio staff (see 2.2).

### 2.1 Stop matching them in this event

```sql
UPDATE "Guest" SET "faceSearchOptOut" = true WHERE id = '<guestId>';   -- or WHERE "userId" = '<userId>' for all their events
```

This stops that guest from running searches (`opted_out`). **It does not remove their face from the
index**, and nothing in the product sets `FaceCluster.suppressed`. To suppress their cluster, find it
from photos you know they appear in, check with the requester, then suppress it:

```sql
SELECT f."clusterId", count(*) AS faces FROM "Face" f
 WHERE f."eventId" = '<eventId>' AND f."photoId" IN ('<photoId>', '<photoId>') GROUP BY 1 ORDER BY 2 DESC;
UPDATE "FaceCluster" SET suppressed = true, "updatedAt" = now() WHERE id = '<clusterId>' AND "eventId" = '<eventId>';
```

Suppression is best-effort (biometrics.md L3): clusters can be split or merged. If the requester needs
certainty, purge the whole event index (section 1) instead. Neither route removes them from other
people's photos (L4).

### 2.2 Delete their data

**Platform operators only.** This is raw SQL against the production database; there is no
studio-facing tool and studio staff must not be given database access to run it. Studios send the
request to the platform operator, who runs it.

Run in `psql` against the target database; set the variables first. The statement deletes saved
matches (the user's own and any guardian matches for the child), revokes the profile and guardian consents, and writes one
audit row with **counts only**, no ids of people. Choose the scope:

- **One event** (`event_id` set; the usual case for "remove me from this wedding"): deletes only the
  matches on that event's photos and the child's consents for that event. The cross-event face
  profile and the user's profile consent are **kept**.
- **All events** (`event_id` empty): also deletes the user's `FaceProfile` and revokes their profile
  consent. The audit row is then not tied to one event; set `studio_id` to empty as well unless the
  person only ever appeared in one studio's events (a single row cannot belong to several studios).
  One-time search consents (`SEARCH_SELF`) are **not** revoked by this statement: nothing is
  persisted for them beyond the row and the saved matches, and the row is evidence. Guardian
  consents (`SEARCH_GUARDIAN`) for the named child are revoked.

**An event-scoped delete can be undone.** It keeps the `FaceProfile`, and `CLUSTER_FACES`
(`_match_profiles`) re-creates `PROFILE_AUTO` matches for any non-deleted guest with a profile on
its next run, without looking at `Guest.faceSearchOptOut` (WRK-020, WRK-010). Today enrolment is off
so no profile can exist; if one does, delete it (run the all-events form, or at least the profile
delete) rather than relying on the event-scoped form or on `faceSearchOptOut`.

`ref` goes into `AuditLog.target`, which is shown to studio and platform admins: use a **ticket id**
(for example `SUP-123`), never an email address or a name.

```sql
\set user_id  '<userId or empty string>'
\set guest_id '<child guestId or empty string>'
\set event_id '<eventId, or empty string for all events>'
\set studio_id '<studioId>'
\set ref      '<ticket id>'
BEGIN;
WITH
  prof     AS (DELETE FROM "FaceProfile" WHERE "userId" = :'user_id' AND :'event_id' = '' RETURNING 1),
  consent  AS (UPDATE "BiometricConsent" SET "revokedAt" = now()
                WHERE "revokedAt" IS NULL
                  AND ((kind = 'FACE_PROFILE' AND "consentedByUserId" = :'user_id' AND :'event_id' = '')
                       OR ("subjectGuestId" = :'guest_id' AND (:'event_id' = '' OR "eventId" = :'event_id')))
                RETURNING 1),
  pm_user  AS (DELETE FROM "PhotoMatch" WHERE "userId" = :'user_id'
                AND (:'event_id' = '' OR "photoId" IN (SELECT id FROM "Photo" WHERE "eventId" = :'event_id')) RETURNING 1),
  pm_child AS (DELETE FROM "PhotoMatch" WHERE "subjectGuestId" = :'guest_id'
                AND (:'event_id' = '' OR "photoId" IN (SELECT id FROM "Photo" WHERE "eventId" = :'event_id')) RETURNING 1),
  audit    AS (INSERT INTO "AuditLog"("studioId", "eventId", action, target, data)
               VALUES (NULLIF(:'studio_id', ''), NULLIF(:'event_id', ''), 'dsar.biometric.delete', :'ref',
                       jsonb_build_object('scope', CASE WHEN :'event_id' = '' THEN 'all-events' ELSE 'event' END,
                                          'profiles', (SELECT count(*) FROM prof),
                                          'consentsRevoked', (SELECT count(*) FROM consent),
                                          'userMatches', (SELECT count(*) FROM pm_user),
                                          'childMatches', (SELECT count(*) FROM pm_child)))
               RETURNING data)
SELECT * FROM audit;
-- check the counts look right, then:
COMMIT;   -- or ROLLBACK;
```

Notes:

- `PhotoMatch.subjectGuestId` has **no foreign key**: deleting a child's guest row would leave the
  matches behind, which is why they are deleted here explicitly.
- `BiometricConsent` rows are **revoked, not deleted**: they are the evidence of what was agreed.
  How long they are kept is open (biometrics.md C12).
- An empty variable matches nothing (`"userId" = ''`), so you can run the statement for only a user
  or only a child.
- This is also what a "delete my data" request (WEB-006) will need; the full DSAR rules, including
  what is anonymised rather than deleted, are LEG-007.

### 2.3 Verify

```sql
SELECT (SELECT count(*) FROM "FaceProfile" WHERE "userId" = :'user_id') AS profiles_left,
       (SELECT count(*) FROM "PhotoMatch" WHERE ("userId" = :'user_id' OR "subjectGuestId" = :'guest_id')
          AND (:'event_id' = '' OR "photoId" IN (SELECT id FROM "Photo" WHERE "eventId" = :'event_id'))) AS matches_left;
```

`matches_left` must be 0; `profiles_left` must be 0 for an all-events request (an event-scoped one keeps the profile). Then confirm the audit row: `SELECT * FROM "AuditLog" WHERE action = 'dsar.biometric.delete' ORDER BY id DESC LIMIT 1;`.

### 2.4 Tell the requester the truth

Their selfie and search signature were never kept. Their face signature in this event's index is
removed only if section 1 was run or their cluster was suppressed (best-effort). They remain visible
in the photos themselves. Backups still hold the old data until they expire (section 3).

## 3. Backups

Backups and point-in-time recovery contain every embedding that existed when they were taken, until
that backup expires, and a restore re-creates data you purged. The destruction timeline is therefore
**purge date + the backup retention tail**. Backup retention and the restore procedure belong to
DOC-003 (`docs/ops/backups.md`); this runbook does not describe them.

What you must do here:

1. In the request record, state the backup retention from `docs/ops/backups.md` as the date by which
   the data will have left backups.
2. After any restore, re-run section 1 for every event purged after the restore point and section 2
   for every person deleted after it. Per-person deletions cannot be replayed from the database
   alone; a record kept outside it is LEG-008. Until it exists, keep your own list of
   section 2 requests (reference, date, user or guest id) somewhere outside Postgres.

## 4. What this runbook cannot do

- It cannot remove a person from photos, or from matches other people saved (biometrics.md L4, L7).
- It does not prove the absence of copies outside the database: temporary files, logs, exports.
- `verify-purge` checks one database at one moment. It does not detect a later re-index (G4).
- It is operator-run; no schedule, alert or automation backs it (WRK-012, ADM-023).

## 5. Execution record

| Date | Where | What | Result |
|---|---|---|---|
| 2026-10-08 | Local database `hub_t63`, seed event `priya-arjun` | Sections 1.1-1.6, run twice (second run after the review changes, with face search on, then off, before the purge). The seed event has no photos, so two photos, two faces, one cluster and one saved match were inserted by SQL to stand in for an indexed gallery; face search was switched off by SQL (the settings form needs a browser session); the purge job was queued with the same `enqueue()` and audit row the admin action writes and run by the real handler through `run_once`. The section 2.2 SQL was run, unscoped and event-scoped, inside transactions that were rolled back, against fixture rows. | Before: 4 FAIL (faces, clusters, photos, purge stamp; plus a WARN for face search on). After: `RESULT: PASS`, `faceindex.purge` data `{"faces": 2, "clusters": 1, "photos": 2, "jobId": 57}`. Output is in the LEG-005 pull request. |

Add a row each time the runbook is executed for real.
