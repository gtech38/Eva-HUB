"""Shared fixtures for Postgres-backed worker tests.

`conn`   module-scoped autocommit connection; skips the module when Postgres is unreachable.
`queue`  an `IsolatedJobQueue`: a private job type per test, claims restricted to that type and
         asserted by id, and teardown that deletes every Job row created during the test.
`tenant` a throwaway Studio + Event (`tests/tenants.py`) with helpers for users, photos and faces.
         Teardown deletes, in one transaction, the event's PhotoMatch/Face/FaceCluster/Photo/ZipExport/
         AuditLog rows, the event, the studio and the users it made. A module-scoped sweep removes
         prefixed test tenants older than an hour, left by killed runs.

These tests must not share a database with a running consumer (`make dev` / `make consume`):
a consumer without `only_types` claims every due row, including TEST_* ones. Point the suite
at its own database (or stop the consumer) before running it.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Mapping

import psycopg
import pytest

from hub_worker import jobs
from hub_worker.db import connect
from tenants import Tenant, sweep_stale_tenants

WORKER_ID = "pytest"
CLAIM_TIMEOUT_S = 0.25  # long enough for timestamp(3) rounding, short enough to expose a real delay


@pytest.fixture(scope="module")
def conn():
    try:
        c = connect(autocommit=True)
    except psycopg.OperationalError as exc:  # pragma: no cover
        pytest.skip(f"postgres not reachable: {exc}")
    yield c
    c.close()


@pytest.fixture(scope="module")
def stale_test_jobs_swept(conn):
    """Recover from killed runs: drop TEST_* rows older than an hour (live runs are younger)."""
    with conn.cursor() as cur:
        cur.execute(
            """DELETE FROM "Job"
                WHERE type LIKE 'TEST\\_%' AND "createdAt" < now() - interval '1 hour'"""
        )


class IsolatedJobQueue:
    """One test's private slice of the Job table."""

    def __init__(self, conn: psycopg.Connection, label: str) -> None:
        self.conn = conn
        self.type = f"TEST_{label}_{uuid.uuid4().hex[:8]}"
        self.ids: list[int] = []

    def enqueue(self, payload: Mapping[str, Any] | None = None, **kw: Any) -> int | None:
        return jobs.enqueue(self.conn, self.type, payload or {}, **kw)

    def run_next(self, handlers: Mapping[str, jobs.Handler]) -> dict | None:
        """One `run_once` restricted to this test's type; None when nothing of ours is due."""
        return jobs.run_once(self.conn, handlers, worker_id=WORKER_ID, only_types=[self.type])

    def run_job(
        self, handlers: Mapping[str, jobs.Handler], job_id: int, timeout_s: float = CLAIM_TIMEOUT_S
    ) -> dict:
        """Claim and run `job_id`, waiting up to `timeout_s` for it to be due. Asserts the id."""
        deadline = time.monotonic() + timeout_s
        while (job := self.run_next(handlers)) is None:
            assert time.monotonic() < deadline, (
                f"job {job_id} ({self.type}) not claimable within {timeout_s}s"
            )
            time.sleep(0.002)
        assert int(job["id"]) == job_id, f"claimed job {job['id']}, expected {job_id}"
        return job

    def row(self, job_id: int) -> dict:
        with self.conn.cursor() as cur:
            cur.execute('SELECT *, "runAt" > now() AS future FROM "Job" WHERE id = %s', (job_id,))
            return cur.fetchone()

    def due_now(self, job_id: int) -> bool:
        """True when runAt is at most 1 ms after the database clock (delay 0 means due now)."""
        with self.conn.cursor() as cur:
            cur.execute(
                """SELECT "runAt" - now() <= interval '1 millisecond' AS due
                     FROM "Job" WHERE id = %s""",
                (job_id,),
            )
            return cur.fetchone()["due"]

    def cleanup(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "Job" WHERE type = %s OR id = ANY(%s)', (self.type, self.ids))


@pytest.fixture
def queue(conn, stale_test_jobs_swept, request, monkeypatch):
    """Per-test queue; every `jobs.enqueue` during the test is recorded for teardown."""
    q = IsolatedJobQueue(conn, request.node.name.removeprefix("test_")[:24].upper())
    enqueue = jobs.enqueue

    def tracked_enqueue(*args: Any, **kwargs: Any) -> int | None:
        job_id = enqueue(*args, **kwargs)
        if job_id is not None and job_id not in q.ids:
            q.ids.append(job_id)
        return job_id

    monkeypatch.setattr(jobs, "enqueue", tracked_enqueue)
    yield q
    q.cleanup()


@pytest.fixture(scope="module")
def stale_tenants_swept(conn):
    """Recover from killed runs: drop test-studio-/test-event-/test-user- rows older than an hour."""
    sweep_stale_tenants(conn)


@pytest.fixture
def tenant(conn, stale_tenants_swept):
    """A private Studio + Event (`tests/tenants.py`); cleaned up even when setup or the test fails."""
    t = Tenant(conn)
    try:
        t.create()
        yield t
    finally:
        t.cleanup()
