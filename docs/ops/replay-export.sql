-- Export the AuditLog rows the restore must replay (runbook-restore.md step 6c). Run on the OLD
-- instance, in a read-only session, with T passed as a psql variable (never interpolated by a shell):
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$OLD_URL" -X -q -v ON_ERROR_STOP=1 -v T="$T" -f docs/ops/replay-export.sql > ./restore/replay-audit.csv
--
-- T may carry an offset ('2026-10-08T17:30:00+05:30'); without one it is read as UTC. AuditLog."createdAt"
-- is TIMESTAMP(3) WITHOUT TIME ZONE holding UTC (Prisma), so T is converted to UTC before comparing.
-- Output columns match the temp table in the runbook: id, action, eventId, target, createdAt.
--
-- These action names are a restore contract: scripts/tests/test_restore_contracts.py fails if a
-- writer under apps/ or workers/ stops emitting one of them.
SET TimeZone = 'UTC';
COPY (
  SELECT id, action, "eventId", target, "createdAt"
  FROM "AuditLog"
  WHERE "createdAt" > (:'T'::timestamptz AT TIME ZONE 'UTC')
    AND action IN (
      'faceindex.purge',
      'faceindex.purge.request',
      'event.facesearch.disable',
      'event.facesearch.enable',
      'photo.delete'
    )
  ORDER BY "createdAt", id
) TO STDOUT WITH (FORMAT csv);
