-- WEB-017: gallery pages are keyset-paginated on ("sortKey", "id"), so every photo needs a sortKey.
-- The worker (process_photo.py) writes isoformat(timespec="milliseconds") of capturedAt, falling
-- back to createdAt, as a naive wall-clock string; do the same for rows created before that
-- (or still unprocessed). Both columns are TIMESTAMP(3) without time zone, so to_char formats
-- the stored value as is. Idempotent: only rows with no key are touched.
UPDATE "Photo"
SET "sortKey" = to_char(COALESCE("capturedAt", "createdAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS')
WHERE "sortKey" IS NULL;
