-- Replay event-level face-index decisions made after the restore point T (runbook-restore.md step 6c).
--
-- Run on the NEW (restored) instance, inside the transaction the runbook opens, after loading
--   replay_audit (action text, "eventId" text, "createdAt" timestamptz)
-- from the OLD instance's "AuditLog" rows with "createdAt" > T. A restore to T rolled those rows
-- back together with the changes they record; the old instance still has them.
--
-- Covers the actions the code writes today:
--   event.facesearch.disable / event.facesearch.enable  (admin event settings)
--   faceindex.purge.request                             (admin "Purge now")
--   faceindex.purge                                     (worker PURGE_FACE_INDEX, incl. date-driven purges)
-- Per-person actions (profile revokes, "remove me", DSAR deletions) are not audited in a form
-- that can be replayed yet: LEG-008.

-- 1. Face search on/off: the last toggle after T wins.
UPDATE "Event" e
SET "faceSearchEnabled" = (t.action = 'event.facesearch.enable')
FROM (
  SELECT DISTINCT ON ("eventId") "eventId", action
  FROM replay_audit
  WHERE action IN ('event.facesearch.enable', 'event.facesearch.disable') AND "eventId" IS NOT NULL
  ORDER BY "eventId", "createdAt" DESC
) t
WHERE e.id = t."eventId";

-- 2. Indexing work that was queued at T for an event purged after T must not run first and
--    re-create the embeddings the purge removed. Park it (DEAD, with a reason); the purge below
--    deletes whatever is left anyway.
UPDATE "Job" j
SET status = 'DEAD'::"JobStatus",
    "lastError" = 'parked after restore: event face index was purged after the restore point'
WHERE j.status = 'QUEUED'::"JobStatus"
  AND (
    (j.type = 'CLUSTER_FACES' AND j.payload->>'eventId' IN (
      SELECT "eventId" FROM replay_audit WHERE action IN ('faceindex.purge', 'faceindex.purge.request')))
    OR
    (j.type = 'INDEX_FACES' AND j.payload->>'photoId' IN (
      SELECT p.id FROM "Photo" p
      WHERE p."eventId" IN (SELECT "eventId" FROM replay_audit WHERE action IN ('faceindex.purge', 'faceindex.purge.request'))))
  );

-- 3. Purge again every event purged, or asked to be purged, after T. Same upsert as the worker's
--    jobs.enqueue: RUNNING rows are left alone; QUEUED rows keep attempts and the later runAt;
--    finished/dead rows are reset; payload refreshed; stale lock and error cleared.
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
                     THEN GREATEST("Job"."runAt", EXCLUDED."runAt") ELSE EXCLUDED."runAt" END,
  attempts    = CASE WHEN "Job".status = 'QUEUED'::"JobStatus" THEN "Job".attempts ELSE 0 END,
  "lastError" = NULL,
  "lockedBy"  = NULL,
  "lockedAt"  = NULL
WHERE "Job".status <> 'RUNNING'::"JobStatus";
