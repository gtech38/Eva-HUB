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


def _source_url() -> str:
    url = os.environ.get("DATABASE_URL") or _env_file_value("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL is not set and there is no .env")
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
pytestmark = pytest.mark.skipif(SKIP_REASON is not None, reason=SKIP_REASON or "")


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
                'CREATE TABLE "Face" (id text PRIMARY KEY, embedding vector(3), meta jsonb, raw bytea,'
                ' at timestamptz, score double precision, tags text[], note text)'
            )
            conn.execute(
                """INSERT INTO "Face" VALUES
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
    assert _reported_counts(proc.stdout)["Face"] == (2, 2)


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
        day = time.strftime("%Y-%m-%d", time.gmtime())
        names = {line.split()[-1] for line in listing.stdout.splitlines() if line.strip()}
        assert names == {f"{day}.dump", f"{day}.dump.manifest"}, listing.stdout + listing.stderr
    finally:
        _aws(cfg, "s3", "rm", "--recursive", f"s3://{cfg['S3_BUCKET']}/{prefix}/")


def test_drill_without_manifest_or_source_url_refuses_to_guess(dump: Path, tmp_path: Path) -> None:
    lone = tmp_path / "lone.dump"
    shutil.copyfile(dump, lone)
    proc = _server_drill(lone, _scratch_name())

    assert proc.returncode == 2, _out(proc)
    assert "manifest" in _out(proc)
