#!/usr/bin/env bash
# Restore drill: restore a pg_dump -Fc backup into a throwaway database, run
# `prisma migrate status` against it, compare every table's row count and checksum with the
# source, print timings, tear down. Exits non-zero on any difference. See docs/ops/backups.md.
#
#   scripts/restore-drill.sh <backup.dump>
#
# Target (throwaway, always created by this script and always removed afterwards):
#   default             a fresh pgvector/pgvector:pg16 container on a random localhost port, named
#                       hub-restore-drill-<db>-<random> with a data volume of the same name
#   RESTORE_SERVER_URL  instead, a new database on this server, e.g. the compose Postgres:
#                       postgresql://hub:hub@localhost:5433/postgres
#   RESTORE_DB_NAME     throwaway database name; must look like <name>_restore_<suffix>
#                       (default hub_restore_<UTC timestamp>_<random>). An existing database,
#                       container or volume is never reused, and never removed.
# Expected data:
#   <backup.dump>.manifest (written by scripts/backup-db.sh from the dump's own snapshot), or
#   SOURCE_DATABASE_URL    count/checksum a live database instead (it may have moved on since the dump).
#   The run refuses (exit 2) when the manifest is empty or, unless DRILL_SKIP_PRISMA=1, has no
#   _prisma_migrations line, and fails when it compares zero tables: it cannot pass vacuously.
# Other: DRILL_SKIP_PRISMA=1 skips `prisma migrate status` (no node toolchain);
#        PG_TOOLS=native|docker|auto, PG_TOOLS_IMAGE (see scripts/lib/pg.sh).
#
# Exit codes: 0 restored and identical; 1 restore failed or data differs; 2 usage / refused.
set -euo pipefail
LOG_TAG=restore-drill
# shellcheck source-path=SCRIPTDIR source=lib/pg.sh
. "$(dirname "$0")/lib/pg.sh"

[ $# -eq 1 ] && [ "${1#-}" = "$1" ] || die "usage: scripts/restore-drill.sh <backup.dump>" 2
DUMP=$1
# random suffix: two drills started in the same second must never share a name
NAME=${RESTORE_DB_NAME:-hub_restore_$(date -u +%Y%m%d%H%M%S)_$(rand_hex)}

# Matches the WHOLE string: a line-oriented grep would accept "ok_restore_x<newline>anything".
# The name is interpolated into CREATE / DROP DATABASE, so it must be a plain identifier.
case $NAME in *[!a-z0-9_]*) die "RESTORE_DB_NAME is not a throwaway name: only lowercase letters, digits and _ are allowed" 2 ;; esac
[[ $NAME =~ ^[a-z][a-z0-9_]*_restore_[a-z0-9_]+$ && ${#NAME} -le 63 ]] ||
  die "RESTORE_DB_NAME '$NAME' is not a throwaway name: use lowercase <name>_restore_<suffix> (max 63 chars)" 2
[ -r "$DUMP" ] || die "cannot read $DUMP" 2

EXPECTED_FROM=""
if [ -f "$DUMP.manifest" ]; then
  EXPECTED_FROM="manifest"
elif [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  EXPECTED_FROM="live"
else
  die "no $DUMP.manifest and no SOURCE_DATABASE_URL: nothing to verify the restore against (make the dump with scripts/backup-db.sh)" 2
fi

init_pg_tools
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hub-drill.XXXXXX")
CONTAINER=""
ADMIN=""
CREATED=0

# shellcheck disable=SC2329 # invoked by the EXIT trap below
teardown() {
  if [ -n "$CONTAINER" ]; then
    # -v removes the container's anonymous volumes; the named data volume is removed explicitly
    docker rm -fv "$CONTAINER" >/dev/null 2>&1 || log "warning: could not remove container $CONTAINER"
    docker volume rm -f "$CONTAINER" >/dev/null 2>&1 || log "warning: could not remove volume $CONTAINER"
  fi
  if [ "$CREATED" = 1 ]; then
    pg_run psql "$(tool_url "$ADMIN")" -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$NAME\" WITH (FORCE)" </dev/null >/dev/null ||
      log "warning: could not drop throwaway database $NAME"
  fi
  rm -rf "$WORK"
}
trap teardown EXIT
trap 'exit 130' INT TERM

# target_run TOOL ARGS… -> run a client tool against the restore target
target_run() {
  if [ -n "$CONTAINER" ]; then pg_exec "$CONTAINER" "$@"; else pg_run "$@"; fi
}

provision_container() {
  # The container's name doubles as its data volume's name, so teardown removes exactly that
  # volume. Random suffix + refuse-if-exists + claim-only-after-success: teardown can never
  # remove a container or volume this run did not create.
  local candidate i
  candidate="hub-restore-drill-$NAME-$(rand_hex)"
  if docker container inspect "$candidate" >/dev/null 2>&1 || docker volume inspect "$candidate" >/dev/null 2>&1; then
    die "a container or volume named $candidate already exists; refusing to use or remove it" 2
  fi
  docker run -d --rm --name "$candidate" --label "hub.restore-drill=$NAME" \
    -v "$candidate:/var/lib/postgresql/data" \
    -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB="$NAME" \
    -p 127.0.0.1::5432 "$PG_TOOLS_IMAGE" >/dev/null ||
    die "could not start the throwaway Postgres container $candidate"
  CONTAINER=$candidate
  # TCP check: the image's init phase only listens on the socket, so this means "really up".
  for i in $(seq 1 120); do
    docker exec "$CONTAINER" pg_isready -q -h 127.0.0.1 -U drill -d "$NAME" && break
    [ "$i" -lt 120 ] || die "throwaway Postgres did not become ready"
    sleep 0.5
  done
  TARGET_TOOL_URL="postgresql://drill:drill@127.0.0.1:5432/$NAME"
  TARGET_HOST_URL="postgresql://drill:drill@127.0.0.1:$(docker port "$CONTAINER" 5432/tcp | head -1 | sed 's/.*://')/$NAME"
  log "target: container $CONTAINER, database $NAME"
}

provision_database() {
  ADMIN=$(libpq_url "$RESTORE_SERVER_URL")
  [ "$NAME" != "$(url_db "$ADMIN")" ] || die "RESTORE_DB_NAME must differ from the admin database" 2
  pg_run psql "$(tool_url "$ADMIN")" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$NAME\"" </dev/null ||
    die "could not create throwaway database $NAME (it must not already exist; existing databases are never reused)"
  CREATED=1
  TARGET_HOST_URL=$(url_with_db "$ADMIN" "$NAME")
  TARGET_TOOL_URL=$(tool_url "$TARGET_HOST_URL")
  log "target: database $NAME on $(printf '%s' "$ADMIN" | sed -E 's#//[^@]*@#//#; s#/[^/]*$##')"
}

migrate_status() {
  if [ "${DRILL_SKIP_PRISMA:-0}" = 1 ]; then
    echo "prisma migrate status: skipped (DRILL_SKIP_PRISMA=1)"
    return 0
  fi
  local out
  if out=$(cd "$HUB_ROOT/packages/db" && DATABASE_URL="$TARGET_HOST_URL" pnpm exec prisma migrate status 2>&1); then
    echo "prisma migrate status: ok ($(printf '%s\n' "$out" | grep -Eo '[0-9]+ migrations? found' | head -1))"
  else
    printf '%s\n' "$out" | tail -n 15 | sed 's/^/  /'
    echo "prisma migrate status: FAILED"
    return 1
  fi
}

T0=$(now)
log "dump: $DUMP ($(wc -c <"$DUMP" | tr -d ' ') bytes), expected data from: $EXPECTED_FROM"
if [ "$EXPECTED_FROM" = manifest ]; then
  LC_ALL=C sort "$DUMP.manifest" >"$WORK/expected"
else
  pg_manifest pg_run "$(tool_url "$(libpq_url "$SOURCE_DATABASE_URL")")" >"$WORK/expected" </dev/null ||
    die "could not read the live source database (SOURCE_DATABASE_URL)"
fi
# A drill that compares nothing must not pass: an empty or truncated manifest is a failure, and
# so is one that does not cover Prisma's own table (it proves the schema came back, not just rows).
[ -s "$WORK/expected" ] || die "the manifest is empty, so there is nothing to verify the restore against" 2
if [ "${DRILL_SKIP_PRISMA:-0}" != 1 ] && ! grep -q "^_prisma_migrations${TAB}" "$WORK/expected"; then
  die "the manifest has no _prisma_migrations line, so it cannot prove the schema was restored (is it truncated?)" 2
fi

if [ -n "${RESTORE_SERVER_URL:-}" ]; then provision_database; else provision_container; fi
T1=$(now)

target_run pg_restore --dbname="$TARGET_TOOL_URL" --no-owner --no-privileges --exit-on-error <"$DUMP" ||
  die "pg_restore failed"
T2=$(now)

STATUS=0
migrate_status || STATUS=1
T3=$(now)

# psql exits 3 on a script error; keep the documented contract (1 = restore failed or differs)
pg_manifest target_run "$TARGET_TOOL_URL" >"$WORK/actual" </dev/null ||
  die "could not read the restored database (manifest query failed)"
echo "row counts and checksums (source = $EXPECTED_FROM, restored = $NAME):"
compare_manifests "$WORK/expected" "$WORK/actual" || STATUS=1
T4=$(now)

printf 'timings: provision %ss  restore %ss  migrate-status %ss  verify %ss  total %ss\n' \
  "$(elapsed "$T0" "$T1")" "$(elapsed "$T1" "$T2")" "$(elapsed "$T2" "$T3")" "$(elapsed "$T3" "$T4")" "$(elapsed "$T0" "$T4")"
if [ "$STATUS" = 0 ]; then echo "restore drill: PASS"; else echo "restore drill: FAIL"; fi
exit "$STATUS"
