"""Shared environment for the Postgres-backed drill tests (DOC-003). Not a test module.

Importing this module checks Docker and the source database once. Locally it skips the importing
test module when they are missing; under CI it raises instead, because a run that skipped
everything would pass vacuously.

Source = $DATABASE_URL (else the repo .env). The source is only ever read, except by tests that
explicitly roll back, and those refuse a database named ``hub`` (see require_not_shared_hub).
"""
from __future__ import annotations

import os
import re
import secrets
import shutil
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

ROOT = Path(__file__).resolve().parents[2]


def env_file_value(name: str) -> str | None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        m = re.match(rf"^\s*{name}\s*=\s*(.*)$", line)
        if m:
            return m.group(1).split(" #")[0].strip().strip('"').strip("'")
    return None


def unavailable(reason: str) -> None:
    """Skip the importing module locally when the stack is down; fail under CI."""
    if os.environ.get("CI"):
        raise RuntimeError(f"restore-drill tests cannot run in CI: {reason}")
    pytest.skip(reason, allow_module_level=True)


def skip_or_fail(reason: str) -> None:
    """The same rule inside a single test: a CI run must not go green by skipping it."""
    if os.environ.get("CI"):
        pytest.fail(f"cannot run in CI: {reason}")
    pytest.skip(reason)


try:
    import psycopg
except ImportError:  # pragma: no cover - environment dependent
    unavailable("psycopg is not installed")


def with_db(url: str, db: str) -> str:
    return urlunsplit(urlsplit(url)._replace(path=f"/{db}"))


def _source_url() -> str:
    url = os.environ.get("DATABASE_URL") or env_file_value("DATABASE_URL")
    if not url:
        unavailable("DATABASE_URL is not set and there is no .env")
    return urlunsplit(urlsplit(url)._replace(query=""))  # drop Prisma's ?schema=… for libpq


SOURCE = _source_url()
SOURCE_DB = urlsplit(SOURCE).path.lstrip("/")
ADMIN = with_db(SOURCE, "postgres")


def _reachable() -> str | None:
    if shutil.which("docker") is None:
        return "docker is not installed"
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        return "docker daemon is not running"
    try:
        psycopg.connect(SOURCE, connect_timeout=3).close()
    except Exception as exc:  # noqa: BLE001 - any connection failure means "unavailable"
        return f"source database unreachable: {exc}"
    return None


_REASON = _reachable()
if _REASON is not None:
    unavailable(_REASON)


def require_not_shared_hub() -> None:
    """Write-then-rollback tests never touch a database named hub (CI's is hub_ci)."""
    if SOURCE_DB == "hub":
        skip_or_fail("never run write-then-rollback SQL on a database named hub; use your own DB (CI uses hub_ci)")


def docker_net_and_host(host: str) -> tuple[list[str], str]:
    """How a container reaches `host` on this machine: host network on Linux, host.docker.internal elsewhere."""
    if os.uname().sysname == "Linux":
        return ["--network", "host"], host
    return [], ("host.docker.internal" if host in {"localhost", "127.0.0.1"} else host)


@pytest.fixture
def make_source() -> Iterator[Callable[..., str]]:
    """Factory for scratch source databases: make_source(*statements) -> url. Dropped afterwards."""
    created: list[str] = []

    def _make(*statements: str) -> str:
        name = f"{SOURCE_DB}_restore_src{secrets.token_hex(3)}"
        with psycopg.connect(ADMIN, autocommit=True) as conn:
            conn.execute(f'CREATE DATABASE "{name}"')
        created.append(name)
        url = with_db(SOURCE, name)
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            for stmt in statements:
                conn.execute(stmt)
        return url

    yield _make
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        for name in created:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
