# shellcheck shell=bash
# Shared helpers for scripts/backup-db.sh and scripts/restore-drill.sh (DOC-003).
#
# Sourced, not executed. Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no
# coproc, no mapfile, no empty "${arr[@]}" under `set -u`.
#
# Postgres client tools (psql, pg_dump, pg_restore) run natively when a v16+ client is on PATH,
# otherwise inside the pgvector image (same major version as the server), so nothing has to be
# installed on a laptop. PG_TOOLS=native|docker|auto (default auto) overrides the choice.

HUB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_TOOLS_IMAGE="${PG_TOOLS_IMAGE:-pgvector/pgvector:pg16}"
PG_TOOLS_MIN_MAJOR=16
TAB="$(printf '\t')"
# Tables whose ROWS are not copied into logical dumps: the gallery face index is recomputed from
# the originals (INDEX_FACES + CLUSTER_FACES), so keeping its embeddings in every dump only
# lengthens how long biometric data outlives its purge (docs/ops/backups.md §7). FaceProfile is
# not reproducible and stays in. Override with BACKUP_EXCLUDE_DATA (empty string = exclude nothing).
# shellcheck disable=SC2034 # read by backup-db.sh and restore-drill.sh, which source this file
DEFAULT_EXCLUDE_DATA="Face FaceCluster"

log() { printf '[%s] %s\n' "${LOG_TAG:-hub}" "$*" >&2; }

# die <message> [exit-code]   (2 = usage / refused, 1 = failure)
die() {
  log "error: $1"
  exit "${2:-1}"
}

now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time' 2>/dev/null || date +%s; }

# seconds between two `now` readings, one decimal
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

# env_or_dotenv NAME -> $NAME if set, else the first NAME=… line of the repo .env, else "".
env_or_dotenv() {
  local name=$1 val
  val=${!name:-}
  if [ -z "$val" ] && [ -f "$HUB_ROOT/.env" ]; then
    val=$(sed -nE "s/^[[:space:]]*${name}[[:space:]]*=[[:space:]]*//p" "$HUB_ROOT/.env" | head -1 |
      sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
  fi
  printf '%s' "$val"
}

# libpq_url URL -> URL without the Prisma-only query parameters libpq rejects (schema=…, etc.).
libpq_url() {
  local url=$1 base query kept="" p
  case "$url" in
    *\?*) base=${url%%\?*} query=${url#*\?} ;;
    *) printf '%s' "$url"; return ;;
  esac
  local IFS='&'
  for p in $query; do
    case "$p" in
      '' | schema=* | connection_limit=* | pool_timeout=* | socket_timeout=* | pgbouncer=* | sslaccept=* | statement_cache_size=*) ;;
      *) kept="${kept:+$kept&}$p" ;;
    esac
  done
  printf '%s' "$base${kept:+?$kept}"
}

# url_db URL -> database name
url_db() {
  local rest=${1#*://}
  rest=${rest#*/}
  printf '%s' "${rest%%\?*}"
}

# url_with_db URL NAME -> same server and credentials, different database
url_with_db() {
  printf '%s' "$1" | sed -E "s#^([a-z]+://[^/?]+)(/[^?]*)?#\\1/$2#"
}

# init_pg_tools: decide native vs docker once; sets PG_MODE and DOCKER_NET.
init_pg_tools() {
  local major
  case "${PG_TOOLS:-auto}" in
    native | docker) PG_MODE=$PG_TOOLS ;;
    auto)
      major=$( (pg_dump --version 2>/dev/null || true) | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p')
      if [ -n "$major" ] && [ "$major" -ge "$PG_TOOLS_MIN_MAJOR" ]; then PG_MODE=native; else PG_MODE=docker; fi
      ;;
    *) die "PG_TOOLS must be native, docker or auto (got '$PG_TOOLS')" 2 ;;
  esac
  DOCKER_NET=""
  if [ "$PG_MODE" = docker ]; then
    command -v docker >/dev/null || die "no Postgres $PG_TOOLS_MIN_MAJOR+ client on PATH and no docker"
    # Linux: share the host network so localhost means the host. Docker Desktop: use host.docker.internal.
    [ "$(uname -s)" = Linux ] && DOCKER_NET="--network host"
  fi
  log "postgres client tools: $PG_MODE"
}

# docker_host_url STRING -> STRING as seen from inside a container: on Docker Desktop (not Linux,
# where --network host is used) localhost / 127.0.0.1 become host.docker.internal.
docker_host_url() {
  if [ "$(uname -s)" = Linux ]; then
    printf '%s' "$1"
  else
    printf '%s' "$1" | sed -E 's#(//|@)(localhost|127\.0\.0\.1)([:/?]|$)#\1host.docker.internal\3#'
  fi
}

# tool_url URL -> URL as seen from wherever pg_run executes the tool
tool_url() {
  if [ "$PG_MODE" = docker ]; then docker_host_url "$1"; else printf '%s' "$1"; fi
}

# split_password ARGS… -> sets PG_ARGV (array, ARGS with any URL password removed) and PG_PW
# (percent-decoded). Command lines are world-readable via `ps`; a password goes in PGPASSWORD,
# which lives only in the child's environment.
split_password() {
  PG_ARGV=()
  PG_PW=""
  local a
  for a in "$@"; do
    if [[ $a =~ ^(.*://[^:/@]*):([^@]*)@(.*)$ ]]; then
      PG_PW=${BASH_REMATCH[2]}
      PG_PW=$(printf '%b' "${PG_PW//%/\\x}")
      a="${BASH_REMATCH[1]}@${BASH_REMATCH[3]}"
    fi
    PG_ARGV+=("$a")
  done
}

# pg_run TOOL ARGS… -> run a Postgres client tool natively or in the tools image (stdin/stdout pass through)
pg_run() {
  split_password "$@"
  (
    # shellcheck disable=SC2030 # the password is deliberately confined to this subshell's environment
    [ -z "$PG_PW" ] || export PGPASSWORD=$PG_PW
    if [ "$PG_MODE" = native ]; then
      exec "${PG_ARGV[@]}"
    else
      # shellcheck disable=SC2086 # DOCKER_NET is intentionally word-split (empty or two words)
      exec docker run --rm -i $DOCKER_NET -e PGPASSWORD -e PGCONNECT_TIMEOUT=10 "$PG_TOOLS_IMAGE" "${PG_ARGV[@]}"
    fi
  )
}

# pg_exec CONTAINER TOOL ARGS… -> like pg_run, inside a running container (same password handling)
pg_exec() {
  local container=$1
  shift
  split_password "$@"
  (
    # shellcheck disable=SC2031 # same: confined to this subshell on purpose
    [ -z "$PG_PW" ] || export PGPASSWORD=$PG_PW
    exec docker exec -i -e PGPASSWORD "$container" "${PG_ARGV[@]}"
  )
}

# manifest_sql [SNAPSHOT [EXCLUDED_TABLES]] -> psql script printing "<table>\t<rows>\t<md5>" for
# every ordinary table in schema public (not views, sequences, other schemas or large objects;
# tables owned by extensions are skipped).
#
# The checksum is order-independent: md5 of the sorted per-row md5s, with the session pinned to
# UTC / ISO dates / C collation so the text form of every row is identical on source and restore.
# It is NOT memory-bounded: string_agg holds 32 bytes per row, so a table with 100 M rows needs
# about 3 GB in the server session. Fine for this product's data; revisit if a table gets huge.
#
# EXCLUDED_TABLES (space-separated) are tables whose rows are left out of the dump
# (pg_dump --exclude-table-data). Their manifest line is the empty table (0 rows, md5 of ''),
# which is what a correct restore of that dump contains. Pass nothing when summarising a restore.
manifest_sql() {
  local snapshot_stmt="" excluded_array="ARRAY[]::text[]" t
  if [ -n "${1:-}" ]; then
    printf '%s' "$1" | grep -Eq '^[0-9A-Fa-f-]+$' || die "invalid snapshot id '$1'"
    snapshot_stmt="SET TRANSACTION SNAPSHOT '$1';"
  fi
  if [ -n "${2:-}" ]; then
    excluded_array="ARRAY["
    for t in $2; do
      [[ $t =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid table name '$t' in the exclude list" 2
      excluded_array="$excluded_array'$t',"
    done
    excluded_array="${excluded_array%,}]"
  fi
  cat <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
$snapshot_stmt
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL IntervalStyle = 'postgres';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';
SELECT CASE WHEN c.relname = ANY ($excluded_array)
  THEN format('SELECT %L, 0::bigint, md5('''')', c.relname)
  ELSE format(
    'SELECT %L, count(*), md5(coalesce(string_agg(md5(t::text), '''' ORDER BY md5(t::text) COLLATE "C"), '''')) FROM %I.%I AS t',
    c.relname, n.nspname, c.relname)
  END
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
ORDER BY c.relname COLLATE "C" \gexec
COMMIT;
SQL
}

# pg_manifest RUNNER URL [SNAPSHOT [EXCLUDED_TABLES]] -> manifest lines, sorted by table name.
# RUNNER is pg_run or any function with the same signature (e.g. one that docker-execs).
pg_manifest() {
  local runner=$1 url=$2 snapshot=${3:-} excluded=${4:-}
  manifest_sql "$snapshot" "$excluded" |
    "$runner" psql "$url" -X -q -A -t -F "$TAB" -v ON_ERROR_STOP=1 -f - |
    LC_ALL=C sort
}

# compare_manifests EXPECTED ACTUAL -> prints a per-table report; exit 1 on any difference.
compare_manifests() {
  awk -F'\t' '
    NR == FNR { ec[$1] = $2; eh[$1] = $3; order[++n] = $1; next }
    { ac[$1] = $2; ah[$1] = $3; if (!($1 in ec)) order[++n] = $1 }
    END {
      printf "  %-28s %10s %10s  %s\n", "table", "source", "restored", "status"
      for (i = 1; i <= n; i++) {
        t = order[i]; s = (t in ec) ? ec[t] : "-"; r = (t in ac) ? ac[t] : "-"; why = ""
        if (!(t in ac)) why = "missing after restore"
        else if (!(t in ec)) why = "not in source"
        else if (ec[t] != ac[t]) why = "row count differs"
        else if (eh[t] != ah[t]) why = "checksum differs"
        if (why != "") { bad++; printf "  %-28s %10s %10s  MISMATCH (%s)\n", t, s, r, why }
        else printf "  %-28s %10s %10s  ok\n", t, s, r
      }
      printf "  %d tables compared, %d mismatched\n", n, bad
      if (n == 0) { print "  nothing was compared: refusing to call that a pass"; exit 1 }
      exit (bad > 0)
    }' "$1" "$2"
}
