-- Replay face-index decisions and photo deletions made after the restore point T
-- (runbook-restore.md step 6c).
--
-- Run on the NEW (restored) instance, inside the transaction the runbook opens, after loading
--   replay_audit (id bigint, action text, "eventId" text, target text, "createdAt" timestamp)
-- from the OLD instance with docs/ops/replay-export.sql. A restore to T rolled those AuditLog rows
-- back together with the changes they record; the old instance still has them.
--
-- Covers the actions the code writes today:
--   event.facesearch.disable / event.facesearch.enable  (admin event settings)
--   faceindex.purge.request                             (admin "Purge now")
--   faceindex.purge                                     (worker PURGE_FACE_INDEX, incl. date-driven purges)
--   photo.delete                                        (admin; target = photo id)
-- Per-person actions (profile revokes, "remove me", DSAR deletions) are not audited in a form
-- that can be replayed yet: LEG-008. Retention changes (event/studio.retention.change) are not
-- replayed: re-apply them in the admin (runbook step 6c).
--
-- Safe to run twice: every statement is idempotent. The worker must be stopped (runbook step 1).

-- 1. Face search on/off: the last toggle after T wins; equal timestamps are ordered by AuditLog id.
UPDATE "Event" e
SET "faceSearchEnabled" = (t.action = 'event.facesearch.enable')
FROM (
  SELECT DISTINCT ON ("eventId") "eventId", action
  FROM replay_audit
  WHERE action IN ('event.facesearch.enable', 'event.facesearch.disable') AND "eventId" IS NOT NULL
  ORDER BY "eventId", "createdAt" DESC, id DESC
) t
WHERE e.id = t."eventId";

-- 2. Photos deleted after T come back with a restore, and with them their Face and PhotoMatch rows.
--    Delete them again; the foreign keys cascade exactly as for the app's prisma.photo.delete.
--    The audit row's eventId must match the photo's: the admin action only deletes within its event.
DELETE FROM "Photo" p
USING replay_audit r
WHERE r.action = 'photo.delete' AND p.id = r.target AND p."eventId" = r."eventId";

-- 3. Indexing work for an event purged after T must not run and re-create the embeddings the
--    purge removed. Park it (DEAD, with a reason), QUEUED *and* RUNNING: the worker is stopped, so
--    a RUNNING row is stale and requeue_stale would otherwise run it again. INDEX_FACES payloads
--    carry photoId (and eventId since ADM-022); match either way.
UPDATE "Job" j
SET status = 'DEAD'::"JobStatus",
    "lastError" = 'parked after restore: event face index was purged after the restore point',
    "lockedBy" = NULL,
    "lockedAt" = NULL
WHERE j.status IN ('QUEUED'::"JobStatus", 'RUNNING'::"JobStatus")
  AND j.type IN ('INDEX_FACES', 'CLUSTER_FACES')
  AND COALESCE(
        j.payload->>'eventId',
        (SELECT p."eventId" FROM "Photo" p WHERE p.id = j.payload->>'photoId')
      ) IN (SELECT "eventId" FROM replay_audit WHERE action IN ('faceindex.purge', 'faceindex.purge.request'));

-- 4. Purge again every event purged, or asked to be purged, after T. This upsert is a copy of the
--    worker's jobs.enqueue (scripts/tests/test_restore_contracts.py keeps them identical):
--    RUNNING rows are left alone; QUEUED rows keep attempts and the later runAt; finished/dead
--    rows are reset; payload refreshed; stale lock, error and finishedAt cleared.
INSERT INTO "Job" (type, payload, status, "runAt", "maxAttempts", "dedupeKey")
SELECT 'PURGE_FACE_INDEX', jsonb_build_object('eventId', r."eventId"), 'QUEUED'::"JobStatus", now(), 5,
       'purge-face:' || r."eventId" || ':replay'
FROM (
  SELECT DISTINCT "eventId" FROM replay_audit
  WHERE action IN ('faceindex.purge', 'faceindex.purge.request') AND "eventId" IS NOT NULL
) r
JOIN "Event" e ON e.id = r."eventId"
ON CONFLICT ("dedupeKey") DO UPDATE SET
  payload     = EXCLUDED.payload,
  status      = 'QUEUED'::"JobStatus",
  "runAt"     = CASE WHEN "Job".status = 'QUEUED'::"JobStatus"
                     THEN GREATEST("Job"."runAt", EXCLUDED."runAt")
                     ELSE EXCLUDED."runAt" END,
  attempts    = CASE WHEN "Job".status = 'QUEUED'::"JobStatus" THEN "Job".attempts ELSE 0 END,
  "lastError" = NULL,
  "finishedAt" = NULL,
  "lockedBy"  = NULL,
  "lockedAt"  = NULL
WHERE "Job".status <> 'RUNNING'::"JobStatus";
