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


def _skip_or_fail(reason: str) -> None:
    """The same rule inside a single test: a CI run must not go green by skipping it."""
    if os.environ.get("CI"):
        pytest.fail(f"cannot run in CI: {reason}")
    pytest.skip(reason)


try:
    import psycopg
except ImportError:  # pragma: no cover - environment dependent
    _unavailable("psycopg is not installed")


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


LOCAL_S3_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}


def _s3() -> tuple[dict[str, str] | None, str]:
    """Local S3 config, or (None, why not). Never a remote endpoint: the test uploads a real dump."""
    keys = ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY")
    cfg = {k: os.environ.get(k) or _env_file_value(k) or "" for k in keys}
    if not all(cfg.values()):
        return None, "S3_* settings are missing"
    host = urlsplit(cfg["S3_ENDPOINT"])
    if host.hostname not in LOCAL_S3_HOSTS:
        return None, f"S3_ENDPOINT {host.hostname} is not local; the upload test only writes to a loopback bucket"
    try:
        socket.create_connection((host.hostname, host.port or 80), timeout=2).close()
    except OSError:
        return None, f"local S3 at {cfg['S3_ENDPOINT']} is not reachable"
    return cfg, ""


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


def test_upload_test_refuses_a_non_local_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("S3_ENDPOINT", "https://abc123.r2.cloudflarestorage.com")
    monkeypatch.setenv("S3_BUCKET", "prod-bucket")
    monkeypatch.setenv("S3_ACCESS_KEY", "k")
    monkeypatch.setenv("S3_SECRET_KEY", "s")

    cfg, why = _s3()

    assert cfg is None
    assert "not local" in why


def test_backup_upload_copies_dump_and_manifest_under_backup_prefix(tmp_path: Path) -> None:
    cfg, why = _s3()
    if cfg is None:
        _skip_or_fail(why)
    assert cfg is not None
    prefix = f"backup/pg-test-{secrets.token_hex(4)}"
    out = tmp_path / "up.dump"
    try:
        proc = _run(BACKUP, str(out), "--upload", BACKUP_S3_PREFIX=prefix, **cfg)
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

    assert proc.returncode == 1, _out(proc)
    assert "pg_restore failed" in _out(proc)
    assert "PASS" not in proc.stdout
    assert not _database_exists(name)


def _pg_dump_without_rows_of(table: str, out: Path) -> None:
    """A dump of the source that silently lacks one table's rows: pg_restore will succeed on it."""
    parts = urlsplit(SOURCE)
    host, net = parts.hostname or "localhost", ["--network", "host"]
    if os.uname().sysname != "Linux":
        net = []
        host = "host.docker.internal" if host in {"localhost", "127.0.0.1"} else host
    with out.open("wb") as fh:
        proc = subprocess.run(
            ["docker", "run", "--rm", *net, "-e", "PGPASSWORD", "pgvector/pgvector:pg16",
             "pg_dump", "-h", host, "-p", str(parts.port or 5432), "-U", parts.username or "postgres",
             "-d", SOURCE_DB, "--format=custom", f'--exclude-table-data=public."{table}"'],
            stdout=fh, stderr=subprocess.PIPE, env={**os.environ, "PGPASSWORD": parts.password or ""},
        )
    assert proc.returncode == 0, proc.stderr.decode()


def test_drill_fails_when_the_restore_succeeds_but_rows_are_missing(dump: Path, tmp_path: Path) -> None:
    lossy = tmp_path / "lossy.dump"
    # Rsvp has rows in the seed and no foreign key points at it, so pg_restore succeeds without them
    # (dropping Guest rows instead would make pg_restore itself fail on Rsvp's foreign key)
    _pg_dump_without_rows_of("Rsvp", lossy)
    # the source's real manifest says Rsvp has rows; the dump does not carry them
    Path(f"{lossy}.manifest").write_text(Path(f"{dump}.manifest").read_text())
    name = _scratch_name()
    proc = _server_drill(lossy, name)

    assert proc.returncode == 1, _out(proc)
    assert "pg_restore failed" not in _out(proc), "the restore itself must succeed; only the comparison catches it"
    assert re.search(r"^\s*Rsvp\s+[1-9]\d*\s+0\s+MISMATCH \(row count differs\)", proc.stdout, re.M), _out(proc)
    assert "restore drill: FAIL" in proc.stdout
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


def test_drill_fails_when_prisma_migrate_status_fails(tmp_path: Path, make_source) -> None:  # type: ignore[no-untyped-def]
    if shutil.which("pnpm") is None:
        _skip_or_fail("pnpm is not installed")
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


def test_face_index_rows_with_opt_outs_and_host_labels_are_dumped_and_verified(
    tmp_path: Path, make_source  # type: ignore[no-untyped-def]
) -> None:
    # FaceCluster.suppressed ("remove me from face search") and the host's label cannot be recomputed
    # from the originals; cluster_faces carries them over only through Face."clusterId". Leaving
    # either table out of a dump would make opted-out people searchable again after a restore.
    url = make_source(
        'CREATE TABLE "FaceCluster" (id text PRIMARY KEY, label text, suppressed boolean NOT NULL DEFAULT false)',
        'CREATE TABLE "Face" (id text PRIMARY KEY, "clusterId" text REFERENCES "FaceCluster"(id), embedding vector(3))',
        'CREATE TABLE "FaceProfile" (id text PRIMARY KEY, embedding vector(3))',
        "INSERT INTO \"FaceCluster\" VALUES ('c1', 'Bride', false), ('c2', NULL, true)",
        "INSERT INTO \"Face\" VALUES ('f1', 'c1', '[1,2,3]'), ('f2', 'c2', '[4,5,6]')",
        "INSERT INTO \"FaceProfile\" VALUES ('p1', '[7,8,9]')",
    )
    out = tmp_path / "faces.dump"
    # a leftover opt-out knob must not be able to drop them either
    backup = _run(BACKUP, str(out), DATABASE_URL=url, BACKUP_EXCLUDE_DATA="Face FaceCluster")
    assert backup.returncode == 0, _out(backup)
    manifest = {ln.split("\t")[0]: int(ln.split("\t")[1]) for ln in _manifest_lines(out)}
    assert manifest == {"Face": 2, "FaceCluster": 2, "FaceProfile": 1}

    name = _scratch_name()
    proc = _server_drill(out, name, DRILL_SKIP_PRISMA="1")
    assert proc.returncode == 0, _out(proc)
    assert _reported_counts(proc.stdout) == {"Face": (2, 2), "FaceCluster": (2, 2), "FaceProfile": (1, 1)}

    # and the checksum is what proves the opt-out survived: flip it in the manifest and the drill fails
    flipped = _tampered(out, tmp_path, "FaceCluster", 2, "0" * 32)
    bad = _server_drill(flipped, _scratch_name(), DRILL_SKIP_PRISMA="1")
    assert bad.returncode == 1, _out(bad)
    assert re.search(r"^\s*FaceCluster\s+2\s+2\s+MISMATCH \(checksum differs\)", bad.stdout, re.M), _out(bad)


def _docker_shim(tmp_path: Path) -> tuple[dict[str, str], Path]:
    """A `docker` wrapper that logs every argv (to prove what reaches a command line).

    With SHIM_FAIL_RUN_D=1 in the environment, `docker run -d …` fails as if the name were taken.
    """
    log = tmp_path / "docker-argv.log"
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    real = shutil.which("docker")
    assert real
    shim = shim_dir / "docker"
    shim.write_text(
        "#!/bin/bash\n"
        f'printf "%s\\n" "$*" >> "{log}"\n'
        'if [ "${SHIM_FAIL_RUN_D:-}" = 1 ] && [ "$1" = run ] && [ "$2" = -d ]; then\n'
        '  echo "docker: Error response from daemon: Conflict. The container name is already in use." >&2\n'
        "  exit 125\n"
        "fi\n"
        f'exec "{real}" "$@"\n'
    )
    shim.chmod(0o755)
    return {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}", "PG_TOOLS": "docker"}, log


def test_container_teardown_never_removes_what_the_drill_did_not_create(dump: Path, tmp_path: Path) -> None:
    env, log = _docker_shim(tmp_path)
    proc = _drill(dump, RESTORE_DB_NAME=_scratch_name(), SHIM_FAIL_RUN_D="1", **env)

    assert proc.returncode != 0, _out(proc)
    argv = log.read_text()
    assert "run -d" in argv
    # the run failed, so the name may belong to someone else: nothing may be removed under it
    assert not re.search(r"^rm ", argv, re.M), argv
    assert "volume rm" not in argv, argv


def test_default_throwaway_names_do_not_collide_within_a_second(dump: Path, tmp_path: Path) -> None:
    names = set()
    for i in range(2):
        run_dir = tmp_path / f"run{i}"
        run_dir.mkdir()
        env, log = _docker_shim(run_dir)
        _drill(dump, SHIM_FAIL_RUN_D="1", **env)  # stops right after the name is chosen
        names.update(re.findall(r"--name (hub-restore-drill-\S+)", log.read_text()))
    assert len(names) == 2, names


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
    # the container drill mounts a named volume of its own and removes exactly that volume
    mounted = re.findall(r"-v (hub-restore-drill-\S+):/var/lib/postgresql/data", argv)
    assert len(mounted) == 1, argv
    assert f"volume rm -f {mounted[0]}" in argv, argv


def _runbook_sql_blocks() -> list[str]:
    text = (ROOT / "docs" / "ops" / "runbook-restore.md").read_text()
    return re.findall(r"```sql\n(.*?)```", text, re.S)


REPLAY_SQL = ROOT / "docs" / "ops" / "replay-after-restore.sql"
SHARED_HUB_SKIP = pytest.mark.skipif(
    SOURCE_DB == "hub",
    reason="never run write-then-rollback SQL on a database named hub (CI uses hub_ci; locally use your own DB)",
)


def _jobs(conn, type_: str, key: str, ids: list[str]) -> dict[str, tuple]:  # type: ignore[no-untyped-def]
    return {
        r[0]: r[1:]
        for r in conn.execute(
            f"SELECT payload->>'{key}', status::text, attempts, \"lockedBy\", \"lastError\", payload, \"runAt\" > now() + interval '1 hour'"
            ' FROM "Job" WHERE type = %s AND payload->>%s = ANY(%s)',
            (type_, key, ids),
        ).fetchall()
    }


@SHARED_HUB_SKIP
def test_runbook_sql_executes_and_requeues_like_the_worker_enqueue() -> None:
    blocks = _runbook_sql_blocks()
    purge = next(b for b in blocks if "PURGE_FACE_INDEX" in b)
    with psycopg.connect(SOURCE) as conn:
        try:
            events = [r[0] for r in conn.execute('SELECT id FROM "Event" ORDER BY id LIMIT 3').fetchall()]
            assert len(events) == 3
            conn.execute(
                'UPDATE "Event" SET "faceIndexPurgeAt" = now() - interval \'1 day\', "faceIndexPurgedAt" = NULL WHERE id = ANY(%s)',
                (events,),
            )
            # RUNNING, DEAD, and QUEUED-in-the-future with a stale payload: the three branches of jobs.enqueue
            for eid, status, run_at in zip(events, ("RUNNING", "DEAD", "QUEUED"), ("now()", "now()", "now() + interval '1 day'")):
                conn.execute(
                    'INSERT INTO "Job"(type, payload, status, attempts, "lockedBy", "lockedAt", "lastError", "runAt", "dedupeKey")'
                    f" VALUES ('PURGE_FACE_INDEX', %s::jsonb, %s::\"JobStatus\", 3, 'w1', now(), 'boom', {run_at}, %s)",
                    (f'{{"eventId": "{eid}", "stale": true}}', status, f"purge-face:{eid}:restore"),
                )
            conn.execute(purge)
            rows = _jobs(conn, "PURGE_FACE_INDEX", "eventId", events)
            fresh = {"eventId": events[2]}
            # RUNNING rows belong to a live worker: untouched (same rule as jobs.enqueue)
            assert rows[events[0]][:4] == ("RUNNING", 3, "w1", "boom")
            # finished/dead rows are reset: requeued with attempts 0, no stale lock or error, fresh payload
            assert rows[events[1]][:4] == ("QUEUED", 0, None, None)
            assert rows[events[1]][4] == {"eventId": events[1]}
            # QUEUED rows keep their attempts and the later runAt, get the fresh payload, lose the stale lock
            assert rows[events[2]][:4] == ("QUEUED", 3, None, None)
            assert rows[events[2]][4] == fresh
            assert rows[events[2]][5] is True, "runAt = GREATEST(existing, new): the later time is kept"
            for block in blocks:
                if block is not purge:
                    conn.execute(block)  # every other runbook SQL block is valid against the real schema
        finally:
            conn.rollback()


@SHARED_HUB_SKIP
def test_replay_re_applies_purges_and_face_search_toggles_from_the_old_audit_log() -> None:
    with psycopg.connect(SOURCE) as conn:
        try:
            ev = [r[0] for r in conn.execute('SELECT id FROM "Event" ORDER BY id LIMIT 4').fetchall()]
            assert len(ev) == 4
            disabled, toggled_back, purged, requested = ev
            conn.execute('UPDATE "Event" SET "faceSearchEnabled" = true WHERE id = ANY(%s)', (ev,))
            conn.execute('UPDATE "Event" SET "faceSearchEnabled" = false WHERE id = %s', (toggled_back,))
            # what the old instance's AuditLog recorded after the restore point T
            conn.execute('CREATE TEMP TABLE replay_audit (action text, "eventId" text, "createdAt" timestamptz)')
            conn.execute(
                "INSERT INTO replay_audit VALUES"
                " ('event.facesearch.disable', %s, now() - interval '3 hours'),"
                " ('event.facesearch.disable', %s, now() - interval '3 hours'),"
                " ('event.facesearch.enable',  %s, now() - interval '2 hours'),"
                " ('faceindex.purge',          %s, now() - interval '2 hours'),"
                " ('faceindex.purge.request',  %s, now() - interval '1 hour'),"
                " ('faceindex.purge',          %s, now() - interval '1 hour')",
                (disabled, toggled_back, toggled_back, purged, requested, purged),
            )
            # indexing work queued at T for a purged event must not run and re-create embeddings
            conn.execute(
                'INSERT INTO "Job"(type, payload, status, "dedupeKey") VALUES'
                " ('CLUSTER_FACES', %s::jsonb, 'QUEUED'::\"JobStatus\", %s)",
                (f'{{"eventId": "{purged}"}}', f"cluster:{purged}"),
            )

            conn.execute(REPLAY_SQL.read_text())

            enabled = dict(conn.execute('SELECT id, "faceSearchEnabled" FROM "Event" WHERE id = ANY(%s)', (ev,)).fetchall())
            assert enabled[disabled] is False  # disabled after T: stays disabled
            assert enabled[toggled_back] is True  # last toggle after T wins
            assert enabled[purged] is True and enabled[requested] is True  # untouched by the toggle replay
            purges = _jobs(conn, "PURGE_FACE_INDEX", "eventId", ev)
            assert set(purges) == {purged, requested}  # once each, even with two audit rows for `purged`
            assert all(v[0] == "QUEUED" for v in purges.values())
            cluster = conn.execute(
                "SELECT status::text FROM \"Job\" WHERE \"dedupeKey\" = %s", (f"cluster:{purged}",)
            ).fetchone()
            assert cluster == ("DEAD",)
        finally:
            conn.rollback()


def test_runbook_explains_how_to_load_the_replay_and_that_it_needs_the_old_instance() -> None:
    text = (ROOT / "docs" / "ops" / "runbook-restore.md").read_text()
    assert "replay-after-restore.sql" in text
    assert "replay_audit" in text and "\\copy" in text
    assert "OLD_URL" in text
    assert "LEG-008" in text
    # dumps carry the whole face index now; re-indexing after a restore would undo replayed purges
    assert "SELECT 'INDEX_FACES'" not in text, "no runbook step may re-queue face indexing"
