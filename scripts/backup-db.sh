#!/usr/bin/env bash
# Logical Postgres backup: pg_dump -Fc plus a row-count/checksum manifest, optionally uploaded
# to the configured bucket under backup/pg/. See docs/ops/backups.md (DOC-003).
#
#   scripts/backup-db.sh <out.dump> [--upload]
#
# Writes <out.dump> (custom format) and <out.dump>.manifest ("<table>\t<rows>\t<md5>" per ordinary
# table in schema public), both readable by the owner only (mode 600): a dump holds every
# person's data. Dump and manifest are taken from the same exported snapshot, so the manifest is
# exactly what a restore of this dump must reproduce (scripts/restore-drill.sh checks it). The
# snapshot is one open REPEATABLE READ transaction for the length of the dump; on a large, busy
# database that holds back vacuum's xmin horizon, so schedule backups off-peak.
#
# The ROWS of Face and FaceCluster are not dumped (their tables are; the manifest lists them as
# empty): the gallery face index is recomputed from the originals, and leaving embeddings out of
# every dump shortens how long biometric data outlives a purge. BACKUP_EXCLUDE_DATA="" dumps
# everything; BACKUP_EXCLUDE_DATA="Face FaceCluster Other" overrides the list. docs/ops/backups.md §7.
#
# Env: DATABASE_URL (else the repo .env) — the source; only read, never written.
#      --upload / BACKUP_UPLOAD=1: copy both files to
#      s3://$S3_BUCKET/${BACKUP_S3_PREFIX:-backup/pg}/<UTC timestamp>.dump, manifest last (a
#      manifest in the bucket means the dump next to it is complete), using S3_ENDPOINT,
#      S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY (else the repo .env) and the `aws` CLI (or the
#      amazon/aws-cli image when it is not installed).
#      PG_TOOLS=native|docker|auto, PG_TOOLS_IMAGE (see scripts/lib/pg.sh).
set -euo pipefail
umask 077
LOG_TAG=backup-db
# shellcheck source-path=SCRIPTDIR source=lib/pg.sh
. "$(dirname "$0")/lib/pg.sh"

usage() { die "usage: scripts/backup-db.sh <out.dump> [--upload]" 2; }

OUT=""
UPLOAD="${BACKUP_UPLOAD:-0}"
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    -h | --help) sed -n '2,25p' "$0"; exit 0 ;;
    -*) usage ;;
    *) [ -z "$OUT" ] || usage; OUT=$arg ;;
  esac
done
[ -n "$OUT" ] || usage
mkdir -p "$(dirname "$OUT")"

SOURCE=$(libpq_url "$(env_or_dotenv DATABASE_URL)")
[ -n "$SOURCE" ] || die "DATABASE_URL is not set (env or .env)" 2
init_pg_tools
SRC=$(tool_url "$SOURCE")

EXCLUDE_DATA=${BACKUP_EXCLUDE_DATA-$DEFAULT_EXCLUDE_DATA} # unset -> default; set but empty -> exclude nothing
DUMP_EXCLUDES=()
for table in $EXCLUDE_DATA; do
  [[ $table =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid table name '$table' in BACKUP_EXCLUDE_DATA" 2
  DUMP_EXCLUDES+=("--exclude-table-data=public.\"$table\"")
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/hub-backup.XXXXXX")
HOLDER_PID=""
cleanup() {
  exec 3>&- 4<&- # EOF on the holder's stdin ends its transaction
  if [ -n "$HOLDER_PID" ]; then kill "$HOLDER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK" "$OUT.partial" "$OUT.manifest.partial"
}
trap cleanup EXIT

# Hold one REPEATABLE READ transaction open and export its snapshot; pg_dump and the manifest
# both import it, so they see exactly the same data even while the app keeps writing.
hold_snapshot() {
  mkfifo "$WORK/in" "$WORK/out"
  pg_run psql "$SRC" -X -q -A -t -v ON_ERROR_STOP=1 <"$WORK/in" >"$WORK/out" &
  HOLDER_PID=$!
  exec 3>"$WORK/in" 4<"$WORK/out"
  echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&3
  read -r -t 60 SNAPSHOT <&4 || die "could not open a snapshot on the source database"
}

release_snapshot() {
  echo "COMMIT;" >&3
  exec 3>&- 4<&-
  wait "$HOLDER_PID" || die "snapshot holder exited with an error"
  HOLDER_PID=""
}

upload() {
  local bucket prefix stamp key endpoint dir
  bucket=$(env_or_dotenv S3_BUCKET)
  [ -n "$bucket" ] || die "--upload needs S3_BUCKET" 2
  prefix=${BACKUP_S3_PREFIX:-backup/pg}
  stamp=$(date -u +%Y-%m-%dT%H%M%SZ) # time of day: two backups in one day must not overwrite each other
  key="$prefix/$stamp.dump"
  endpoint=$(env_or_dotenv S3_ENDPOINT)
  dir=$(cd "$(dirname "$OUT")" && pwd)
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
  AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-$(env_or_dotenv S3_ACCESS_KEY)}
  AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-$(env_or_dotenv S3_SECRET_KEY)}
  AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-$(env_or_dotenv S3_REGION)}
  AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}
  local f
  # dump first, manifest last: the manifest is the "this backup is complete" marker
  for f in "$(basename "$OUT")" "$(basename "$OUT").manifest"; do
    local dest="s3://$bucket/$key${f#"$(basename "$OUT")"}"
    if command -v aws >/dev/null; then
      aws ${endpoint:+--endpoint-url "$endpoint"} s3 cp --only-show-errors "$dir/$f" "$dest"
    else
      command -v docker >/dev/null || die "--upload needs the aws CLI or docker"
      local ep=$endpoint net=""
      if [ "$(uname -s)" = Linux ]; then net="--network host"; else ep=$(docker_host_url "$endpoint"); fi
      # shellcheck disable=SC2086 # net is intentionally word-split
      docker run --rm $net -v "$dir:/backup:ro" -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
        amazon/aws-cli ${ep:+--endpoint-url "$ep"} s3 cp --only-show-errors "/backup/$f" "$dest"
    fi
    log "uploaded $dest"
  done
}

T0=$(now)
log "source: database '$(url_db "$SOURCE")'"
hold_snapshot
log "snapshot $SNAPSHOT"
[ -z "$EXCLUDE_DATA" ] || log "rows of these tables are not dumped: $EXCLUDE_DATA"
pg_run pg_dump "$SRC" --format=custom --snapshot="$SNAPSHOT" ${DUMP_EXCLUDES[@]+"${DUMP_EXCLUDES[@]}"} >"$OUT.partial"
T1=$(now)
pg_manifest pg_run "$SRC" "$SNAPSHOT" "$EXCLUDE_DATA" >"$OUT.manifest.partial"
release_snapshot
[ -s "$OUT.manifest.partial" ] || die "manifest is empty: no tables in schema public?"
chmod 600 "$OUT.partial" "$OUT.manifest.partial"
mv "$OUT.partial" "$OUT"
mv "$OUT.manifest.partial" "$OUT.manifest"
T2=$(now)

if [ "$UPLOAD" = 1 ]; then upload; fi

printf 'backup: %s (%s bytes), manifest: %s tables\n' "$OUT" "$(wc -c <"$OUT" | tr -d ' ')" "$(wc -l <"$OUT.manifest" | tr -d ' ')"
printf 'timings: dump %ss  manifest %ss  total %ss\n' "$(elapsed "$T0" "$T1")" "$(elapsed "$T1" "$T2")" "$(elapsed "$T0" "$(now)")"
