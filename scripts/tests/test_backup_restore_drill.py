"""End-to-end tests for scripts/backup-db.sh and scripts/restore-drill.sh (DOC-003).

The drill script *is* the restore test; these tests prove it restores a real dump, reports the
source row counts, never touches a database it did not create, and fails non-zero when the
restored data differs from the source.

They need Docker and the Postgres in infra/docker-compose.yml (or the CI service container).
Source = $DATABASE_URL (else the repo .env). The source is only ever read. Restore targets are
throwaway databases named ``<source-db>_restore_<random>`` (e.g. ``hub_t76_restore_ab12cd``) or
a throwaway container.

Run:  python -m pytest -q scripts/tests      (any venv with pytest + psycopg)
"""
from __future__ import annotations

import os
import re
import secrets
import shutil
import socket
import stat
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

psycopg = pytest.importorskip("psycopg")

ROOT = Path(__file__).resolve().parents[2]
BACKUP = ROOT / "scripts" / "backup-db.sh"
DRILL = ROOT / "scripts" / "restore-drill.sh"
DRILL_BUDGET_S = 300  # acceptance: the drill completes in under 5 minutes on the seeded DB
KEY_TABLES = ("Event", "Guest", "Photo")


def _env_file_value(name: str) -> str | None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        m = re.match(rf"^\s*{name}\s*=\s*(.*)$", line)
        if m:
            return m.group(1).split(" #")[0].strip().strip('"').strip("'")
    return None


def _unavailable(reason: str) -> None:
    """Skip locally when the stack is down; fail under CI, where skipping would pass vacuously."""
    if os.environ.get("CI"):
        raise RuntimeError(f"restore-drill tests cannot run in CI: {reason}")
    pytest.skip(reason, allow_module_level=True)


def _source_url() -> str:
    url = os.environ.get("DATABASE_URL") or _env_file_value("DATABASE_URL")
    if not url:
        _unavailable("DATABASE_URL is not set and there is no .env")
    parts = urlsplit(url)
    return urlunsplit(parts._replace(query=""))  # drop Prisma's ?schema=… for libpq


def _with_db(url: str, db: str) -> str:
    return urlunsplit(urlsplit(url)._replace(path=f"/{db}"))


def _db_name(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


SOURCE = _source_url()
SOURCE_DB = _db_name(SOURCE)
ADMIN = _with_db(SOURCE, "postgres")


def _reachable() -> str | None:
    if shutil.which("docker") is None:
        return "docker is not installed"
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        return "docker daemon is not running"
    try:
        psycopg.connect(SOURCE, connect_timeout=3).close()
    except Exception as exc:  # noqa: BLE001 - any connection failure means "skip"
        return f"source database unreachable: {exc}"
    return None


SKIP_REASON = _reachable()
if SKIP_REASON is not None:
    _unavailable(SKIP_REASON)


def _scratch_name() -> str:
    return f"{SOURCE_DB}_restore_{secrets.token_hex(4)}"


def _database_exists(name: str) -> bool:
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        return conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone() is not None


def _source_counts() -> dict[str, int]:
    with psycopg.connect(SOURCE) as conn:
        return {t: conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in KEY_TABLES}


def _run(script: Path, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
    full_env = {**os.environ, "DATABASE_URL": SOURCE, **env}
    return subprocess.run(
        ["bash", str(script), *args],
        cwd=ROOT,
        env=full_env,
        capture_output=True,
        text=True,
        timeout=DRILL_BUDGET_S + 60,
    )


def _drill(dump: Path, **env: str) -> subprocess.CompletedProcess[str]:
    return _run(DRILL, str(dump), **env)


def _server_drill(dump: Path, name: str, **env: str) -> subprocess.CompletedProcess[str]:
    return _drill(dump, RESTORE_SERVER_URL=ADMIN, RESTORE_DB_NAME=name, **env)


def _out(proc: subprocess.CompletedProcess[str]) -> str:
    return proc.stdout + proc.stderr


def _reported_counts(output: str) -> dict[str, tuple[int, int]]:
    """Parse the drill's per-table lines: '<table>  <source>  <restored>  <status>'."""
    found: dict[str, tuple[int, int]] = {}
    for line in output.splitlines():
        m = re.match(r"^\s*(\w+)\s+(\d+)\s+(\d+)\s+(ok|MISMATCH)\b", line)
        if m:
            found[m.group(1)] = (int(m.group(2)), int(m.group(3)))
    return found


@pytest.fixture(scope="module")
def dump(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("backup") / "hub.dump"
    proc = _run(BACKUP, str(out))
    assert proc.returncode == 0, _out(proc)
    return out


def _tampered(dump: Path, tmp_path: Path, table: str, column: int, value: str) -> Path:
    """Copy the dump and rewrite one manifest field: simulates a restore that lost/changed rows."""
    copy = tmp_path / "tampered.dump"
    shutil.copyfile(dump, copy)
    lines = []
    for line in Path(f"{dump}.manifest").read_text().splitlines():
        fields = line.split("\t")
        if fields[0] == table:
            fields[column] = value
        lines.append("\t".join(fields))
    Path(f"{copy}.manifest").write_text("\n".join(lines) + "\n")
    return copy


def test_backup_writes_custom_format_dump_and_manifest_matching_source(dump: Path) -> None:
    assert dump.stat().st_size > 0
    assert dump.read_bytes()[:5] == b"PGDMP"  # pg_dump -Fc magic
    manifest = {
        f[0]: (int(f[1]), f[2])
        for f in (line.split("\t") for line in Path(f"{dump}.manifest").read_text().splitlines() if line)
    }
    for table, count in _source_counts().items():
        assert manifest[table][0] == count, table
        assert re.fullmatch(r"[0-9a-f]{32}", manifest[table][1]), table
    assert "_prisma_migrations" in manifest


def test_drill_in_throwaway_container_restores_and_reports_source_counts(dump: Path) -> None:
    name = _scratch_name()
    started = time.monotonic()
    proc = _drill(dump, RESTORE_DB_NAME=name)
    elapsed = time.monotonic() - started

    assert proc.returncode == 0, _out(proc)
    assert elapsed < DRILL_BUDGET_S
    reported = _reported_counts(proc.stdout)
    for table, count in _source_counts().items():
        assert reported[table] == (count, count), table
    assert "prisma migrate status: ok" in proc.stdout
    assert re.search(r"total\s+\d+(\.\d+)?s", proc.stdout), "timings are printed"
    leftovers = subprocess.run(
        ["docker", "ps", "-aq", "--filter", f"label=hub.restore-drill={name}"], capture_output=True, text=True
    ).stdout.split()
    assert leftovers == [], "throwaway container is torn down"


def test_drill_on_compose_server_uses_a_throwaway_database_and_drops_it(dump: Path) -> None:
    name = _scratch_name()
    proc = _server_drill(dump, name)

    assert proc.returncode == 0, _out(proc)
    reported = _reported_counts(proc.stdout)
    for table, count in _source_counts().items():
        assert reported[table] == (count, count), table
    assert not _database_exists(name)
    assert _database_exists(SOURCE_DB)


def test_drill_fails_non_zero_when_row_counts_differ(dump: Path, tmp_path: Path) -> None:
    expected = _source_counts()["Guest"] + 1
    bad = _tampered(dump, tmp_path, "Guest", 1, str(expected))
    name = _scratch_name()
    proc = _server_drill(bad, name)

    assert proc.returncode != 0
    assert re.search(r"^\s*Guest\s+\d+\s+\d+\s+MISMATCH", proc.stdout, re.M), _out(proc)
    assert not _database_exists(name)


def test_drill_fails_non_zero_when_a_checksum_differs(dump: Path, tmp_path: Path) -> None:
    bad = _tampered(dump, tmp_path, "Event", 2, "0" * 32)
    name = _scratch_name()
    proc = _server_drill(bad, name)

    assert proc.returncode != 0
    assert re.search(r"^\s*Event\s+\d+\s+\d+\s+MISMATCH", proc.stdout, re.M), _out(proc)
    assert not _database_exists(name)


@pytest.mark.parametrize("unsafe", ["hub", SOURCE_DB, "postgres", "hub_restore", "Hub_restore_x; DROP"])
def test_drill_refuses_database_names_that_are_not_throwaway(dump: Path, unsafe: str) -> None:
    proc = _server_drill(dump, unsafe)

    assert proc.returncode == 2, _out(proc)
    assert "RESTORE_DB_NAME" in _out(proc)
    assert _database_exists(SOURCE_DB)


def test_drill_never_drops_a_database_it_did_not_create(dump: Path) -> None:
    name = _scratch_name()
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    try:
        proc = _server_drill(dump, name)
        assert proc.returncode != 0
        assert "already exists" in _out(proc)
        assert _database_exists(name)
    finally:
        with psycopg.connect(ADMIN, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}"')


def test_drill_can_verify_against_a_live_source_instead_of_a_manifest(dump: Path, tmp_path: Path) -> None:
    lone = tmp_path / "live.dump"
    shutil.copyfile(dump, lone)
    proc = _server_drill(lone, _scratch_name(), SOURCE_DATABASE_URL=SOURCE)

    assert proc.returncode == 0, _out(proc)
    assert "source = live" in proc.stdout
    for table, count in _source_counts().items():
        assert _reported_counts(proc.stdout)[table] == (count, count), table


@pytest.fixture
def typed_source() -> Iterator[str]:
    """A scratch source DB holding every column type whose text form must survive dump/restore."""
    name = f"{SOURCE_DB}_restore_src{secrets.token_hex(3)}"
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    url = _with_db(SOURCE, name)
    try:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.execute(
                'CREATE TABLE "TypedColumns" (id text PRIMARY KEY, embedding vector(3), meta jsonb, raw bytea,'
                ' at timestamptz, score double precision, tags text[], note text)'
            )
            conn.execute(
                """INSERT INTO "TypedColumns" VALUES
                ('a', '[0.1,0.2,0.30000001]', '{"b": 1, "a": [1, 2]}', '\\x00ff', '2026-10-08 12:00:00.123456+05:30', 0.1 + 0.2, '{x,"y z"}', 'తెలుగు'),
                ('b', NULL, NULL, NULL, NULL, NULL, NULL, NULL)"""
            )
        yield url
    finally:
        with psycopg.connect(ADMIN, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_vector_json_bytea_and_time_columns_restore_with_identical_checksums(typed_source: str, tmp_path: Path) -> None:
    out = tmp_path / "typed.dump"
    backup = _run(BACKUP, str(out), DATABASE_URL=typed_source)
    assert backup.returncode == 0, _out(backup)

    proc = _server_drill(out, _scratch_name(), DRILL_SKIP_PRISMA="1")

    assert proc.returncode == 0, _out(proc)
    assert _reported_counts(proc.stdout)["TypedColumns"] == (2, 2)


def _s3() -> dict[str, str] | None:
    keys = ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY")
    cfg = {k: os.environ.get(k) or _env_file_value(k) or "" for k in keys}
    if not all(cfg.values()):
        return None
    host = urlsplit(cfg["S3_ENDPOINT"])
    try:
        socket.create_connection((host.hostname, host.port or 80), timeout=2).close()
    except OSError:
        return None
    return cfg


def _aws(cfg: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    endpoint = cfg["S3_ENDPOINT"]
    net: list[str] = ["--network", "host"]
    if os.uname().sysname != "Linux":
        net = []
        endpoint = re.sub(r"//(localhost|127\.0\.0\.1)", "//host.docker.internal", endpoint)
    return subprocess.run(
        ["docker", "run", "--rm", *net,
         "-e", f"AWS_ACCESS_KEY_ID={cfg['S3_ACCESS_KEY']}", "-e", f"AWS_SECRET_ACCESS_KEY={cfg['S3_SECRET_KEY']}",
         "-e", "AWS_DEFAULT_REGION=us-east-1", "amazon/aws-cli", "--endpoint-url", endpoint, *args],
        capture_output=True, text=True,
    )


@pytest.mark.skipif(_s3() is None, reason="local S3 (RustFS) is not reachable")
def test_backup_upload_copies_dump_and_manifest_under_backup_prefix(tmp_path: Path) -> None:
    cfg = _s3()
    assert cfg is not None
    prefix = f"backup/pg-test-{secrets.token_hex(4)}"
    out = tmp_path / "up.dump"
    try:
        proc = _run(BACKUP, str(out), "--upload", BACKUP_S3_PREFIX=prefix)
        assert proc.returncode == 0, _out(proc)

        listing = _aws(cfg, "s3", "ls", f"s3://{cfg['S3_BUCKET']}/{prefix}/")
        names = sorted(line.split()[-1] for line in listing.stdout.splitlines() if line.strip())
        # time-of-day key: two backups on one day must not overwrite each other
        stamp = r"\d{4}-\d{2}-\d{2}T\d{6}Z"
        assert len(names) == 2 and re.fullmatch(rf"{stamp}\.dump", names[0]), listing.stdout + listing.stderr
        assert names[1] == f"{names[0]}.manifest", listing.stdout + listing.stderr
    finally:
        _aws(cfg, "s3", "rm", "--recursive", f"s3://{cfg['S3_BUCKET']}/{prefix}/")


def test_drill_without_manifest_or_source_url_refuses_to_guess(dump: Path, tmp_path: Path) -> None:
    lone = tmp_path / "lone.dump"
    shutil.copyfile(dump, lone)
    proc = _server_drill(lone, _scratch_name())

    assert proc.returncode == 2, _out(proc)
    assert "manifest" in _out(proc)


# ── review fixes (PR #135) ────────────────────────────────────────────────────────────────────


def _copy_with_manifest(dump: Path, tmp_path: Path, manifest: str | None = None, name: str = "copy.dump") -> Path:
    copy = tmp_path / name
    shutil.copyfile(dump, copy)
    text = manifest if manifest is not None else Path(f"{dump}.manifest").read_text()
    Path(f"{copy}.manifest").write_text(text)
    return copy


def _manifest_lines(dump: Path) -> list[str]:
    return Path(f"{dump}.manifest").read_text().splitlines()


@pytest.fixture
def make_source() -> Iterator[object]:
    """Factory for scratch source databases: make_source(*statements) -> url. Dropped afterwards."""
    created: list[str] = []

    def _make(*statements: str) -> str:
        name = f"{SOURCE_DB}_restore_src{secrets.token_hex(3)}"
        with psycopg.connect(ADMIN, autocommit=True) as conn:
            conn.execute(f'CREATE DATABASE "{name}"')
        created.append(name)
        url = _with_db(SOURCE, name)
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            for stmt in statements:
                conn.execute(stmt)
        return url

    yield _make
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        for name in created:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_drill_refuses_a_database_name_with_an_embedded_newline(dump: Path) -> None:
    # a line-oriented grep would accept this: its first line is a perfectly good throwaway name
    proc = _server_drill(dump, f"{SOURCE_DB}_restore_ok\nanything")

    assert proc.returncode == 2, _out(proc)
    assert "RESTORE_DB_NAME" in _out(proc)
    assert _database_exists(SOURCE_DB)


def test_drill_fails_when_the_manifest_is_empty_instead_of_comparing_nothing(dump: Path, tmp_path: Path) -> None:
    empty = _copy_with_manifest(dump, tmp_path, manifest="")
    proc = _server_drill(empty, _scratch_name())

    assert proc.returncode != 0, _out(proc)
    assert "manifest is empty" in _out(proc)
    assert "PASS" not in proc.stdout


def test_drill_fails_when_the_manifest_does_not_cover_prisma_migrations(dump: Path, tmp_path: Path) -> None:
    lines = [ln for ln in _manifest_lines(dump) if not ln.startswith("_prisma_migrations\t")]
    bad = _copy_with_manifest(dump, tmp_path, manifest="\n".join(lines) + "\n")
    proc = _server_drill(bad, _scratch_name())

    assert proc.returncode != 0, _out(proc)
    assert "_prisma_migrations" in _out(proc)
    assert "PASS" not in proc.stdout


def test_drill_fails_on_a_truncated_dump(dump: Path, tmp_path: Path) -> None:
    cut = _copy_with_manifest(dump, tmp_path, name="cut.dump")
    cut.write_bytes(dump.read_bytes()[: dump.stat().st_size // 2])
    name = _scratch_name()
    proc = _server_drill(cut, name)

    assert proc.returncode != 0, _out(proc)
    assert "PASS" not in proc.stdout
    assert not _database_exists(name)


def test_drill_fails_when_the_dump_belongs_to_a_different_database(dump: Path, tmp_path: Path, make_source) -> None:  # type: ignore[no-untyped-def]
    other = make_source('CREATE TABLE "Other" (id text PRIMARY KEY)', "INSERT INTO \"Other\" VALUES ('x')")
    other_dump = tmp_path / "other.dump"
    assert _run(BACKUP, str(other_dump), DATABASE_URL=other).returncode == 0
    mixed = _copy_with_manifest(dump, tmp_path, manifest=Path(f"{other_dump}.manifest").read_text())
    proc = _server_drill(mixed, _scratch_name(), DRILL_SKIP_PRISMA="1")

    assert proc.returncode != 0, _out(proc)
    assert "MISMATCH" in proc.stdout
    assert "missing after restore" in proc.stdout


def test_drill_fails_when_a_table_in_the_restore_is_missing_from_the_manifest(dump: Path, tmp_path: Path) -> None:
    lines = [ln for ln in _manifest_lines(dump) if not ln.startswith("Guest\t")]
    bad = _copy_with_manifest(dump, tmp_path, manifest="\n".join(lines) + "\n")
    proc = _server_drill(bad, _scratch_name())

    assert proc.returncode != 0, _out(proc)
    assert re.search(r"^\s*Guest\s+-\s+\d+\s+MISMATCH \(not in source\)", proc.stdout, re.M), _out(proc)


@pytest.mark.skipif(shutil.which("pnpm") is None, reason="pnpm is not installed")
def test_drill_fails_when_prisma_migrate_status_fails(tmp_path: Path, make_source) -> None:  # type: ignore[no-untyped-def]
    # Prisma's bookkeeping table exists but no migration is recorded as applied
    url = make_source(
        'CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,'
        " finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,"
        " started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)"
    )
    out = tmp_path / "nomig.dump"
    assert _run(BACKUP, str(out), DATABASE_URL=url).returncode == 0
    proc = _server_drill(out, _scratch_name())

    assert proc.returncode != 0, _out(proc)
    assert "prisma migrate status: FAILED" in proc.stdout


def test_backup_and_manifest_are_private_to_the_owner(dump: Path) -> None:
    for f in (dump, Path(f"{dump}.manifest")):
        assert stat.S_IMODE(f.stat().st_mode) == 0o600, f"{f.name} is {oct(stat.S_IMODE(f.stat().st_mode))}"


def test_dumps_manifests_and_restore_dirs_are_gitignored() -> None:
    for path in ("hub.dump", "restore/hub.dump", "x/hub.dump.manifest", "restore/verify.dump"):
        proc = subprocess.run(["git", "check-ignore", "-q", path], cwd=ROOT)
        assert proc.returncode == 0, f"{path} is not ignored"


def test_container_drill_removes_its_data_volume(dump: Path) -> None:
    name = _scratch_name()
    proc = _drill(dump, RESTORE_DB_NAME=name)

    assert proc.returncode == 0, _out(proc)
    volumes = subprocess.run(
        ["docker", "volume", "ls", "-q", "--filter", f"name=hub-restore-drill-{name}"], capture_output=True, text=True
    ).stdout.split()
    assert volumes == []


def test_face_and_facecluster_rows_are_left_out_of_the_dump_and_the_drill_still_passes(
    tmp_path: Path, make_source  # type: ignore[no-untyped-def]
) -> None:
    url = make_source(
        'CREATE TABLE "FaceCluster" (id text PRIMARY KEY, label text)',
        'CREATE TABLE "Face" (id text PRIMARY KEY, "clusterId" text REFERENCES "FaceCluster"(id), embedding vector(3))',
        'CREATE TABLE "FaceProfile" (id text PRIMARY KEY, embedding vector(3))',
        "INSERT INTO \"FaceCluster\" VALUES ('c1', 'Bride')",
        "INSERT INTO \"Face\" VALUES ('f1', 'c1', '[1,2,3]'), ('f2', NULL, '[4,5,6]')",
        "INSERT INTO \"FaceProfile\" VALUES ('p1', '[7,8,9]')",
    )
    out = tmp_path / "faces.dump"
    backup = _run(BACKUP, str(out), DATABASE_URL=url)
    assert backup.returncode == 0, _out(backup)
    manifest = {ln.split("\t")[0]: int(ln.split("\t")[1]) for ln in _manifest_lines(out)}
    # reproducible gallery face index is not copied; the non-reproducible profile embedding is
    assert manifest == {"Face": 0, "FaceCluster": 0, "FaceProfile": 1}

    proc = _server_drill(out, _scratch_name(), DRILL_SKIP_PRISMA="1")
    assert proc.returncode == 0, _out(proc)  # restored Face/FaceCluster really are empty, tables exist
    assert _reported_counts(proc.stdout) == {"Face": (0, 0), "FaceCluster": (0, 0), "FaceProfile": (1, 1)}

    full = tmp_path / "faces-full.dump"
    assert _run(BACKUP, str(full), DATABASE_URL=url, BACKUP_EXCLUDE_DATA="").returncode == 0
    full_manifest = {ln.split("\t")[0]: int(ln.split("\t")[1]) for ln in _manifest_lines(full)}
    assert full_manifest == {"Face": 2, "FaceCluster": 1, "FaceProfile": 1}


def _docker_shim(tmp_path: Path) -> tuple[dict[str, str], Path]:
    """A `docker` wrapper that logs every argv, so tests can prove no password is passed on a command line."""
    log = tmp_path / "docker-argv.log"
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    real = shutil.which("docker")
    assert real
    shim = shim_dir / "docker"
    shim.write_text(f'#!/bin/bash\nprintf "%s\\n" "$*" >> "{log}"\nexec "{real}" "$@"\n')
    shim.chmod(0o755)
    return {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}", "PG_TOOLS": "docker"}, log


def test_passwords_never_appear_on_a_command_line(tmp_path: Path) -> None:
    env, log = _docker_shim(tmp_path)
    out = tmp_path / "pw.dump"
    backup = _run(BACKUP, str(out), **env)
    assert backup.returncode == 0, _out(backup)
    drill = _server_drill(out, _scratch_name(), **env)
    assert drill.returncode == 0, _out(drill)
    container = _drill(out, RESTORE_DB_NAME=_scratch_name(), **env)
    assert container.returncode == 0, _out(container)

    argv = log.read_text()
    assert "://" in argv, "the shim saw the tool invocations"
    assert not re.search(r"://[^/@\s]*:[^@\s]+@", argv), "a URL with an inline password reached a command line"
    assert "PGPASSWORD=" not in argv, "the password value itself must not be on the command line either"


def _runbook_sql_blocks() -> list[str]:
    text = (ROOT / "docs" / "ops" / "runbook-restore.md").read_text()
    return re.findall(r"```sql\n(.*?)```", text, re.S)


@pytest.mark.skipif(
    SOURCE_DB == "hub" and not os.environ.get("CI"),
    reason="never run write-then-rollback SQL on the shared local hub database (CI's is a disposable service container)",
)
def test_runbook_sql_executes_and_requeues_like_the_worker_enqueue(make_source) -> None:  # type: ignore[no-untyped-def]
    blocks = _runbook_sql_blocks()
    purge = next(b for b in blocks if "PURGE_FACE_INDEX" in b)
    with psycopg.connect(SOURCE) as conn:
        try:
            events = [r[0] for r in conn.execute('SELECT id FROM "Event" ORDER BY id LIMIT 2').fetchall()]
            assert len(events) == 2
            conn.execute(
                'UPDATE "Event" SET "faceIndexPurgeAt" = now() - interval \'1 day\', "faceIndexPurgedAt" = NULL WHERE id = ANY(%s)',
                (events,),
            )
            for eid, status in zip(events, ("RUNNING", "DEAD")):
                conn.execute(
                    'INSERT INTO "Job"(type, payload, status, attempts, "lockedBy", "lockedAt", "lastError", "dedupeKey")'
                    " VALUES ('PURGE_FACE_INDEX', %s::jsonb, %s::\"JobStatus\", 3, 'w1', now(), 'boom', %s)",
                    (f'{{"eventId": "{eid}"}}', status, f"purge-face:{eid}:restore"),
                )
            conn.execute(purge)
            rows = {
                r[0]: r[1:]
                for r in conn.execute(
                    'SELECT payload->>\'eventId\', status::text, attempts, "lockedBy", "lastError" FROM "Job"'
                    " WHERE type = 'PURGE_FACE_INDEX' AND payload->>'eventId' = ANY(%s)",
                    (events,),
                ).fetchall()
            }
            # RUNNING rows belong to a live worker: untouched (same rule as jobs.enqueue)
            assert rows[events[0]] == ("RUNNING", 3, "w1", "boom")
            # finished/dead rows are reset: requeued with attempts 0 and no stale lock or error
            assert rows[events[1]] == ("QUEUED", 0, None, None)
            for block in blocks:
                if block is not purge:
                    conn.execute(block)  # every other runbook SQL block is valid against the real schema
        finally:
            conn.rollback()
