"""Shared fixtures for Postgres-backed worker tests.

`conn`   module-scoped autocommit connection; skips the module when Postgres is unreachable.
`queue`  an `IsolatedJobQueue`: a private job type per test, claims restricted to that type and
         asserted by id, and teardown that deletes every Job row created during the test.

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

from psycopg.types.json import Jsonb

from hub_worker import jobs
from hub_worker.db import connect, new_id, vec_literal

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


class Tenant:
    """A throwaway studio + event; rows hung off it are removed by `cleanup()`."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn
        tag = uuid.uuid4().hex[:10]
        self.studio_id = f"test-studio-{tag}"
        self.event_id = f"test-event-{tag}"
        self.user_ids: list[str] = []
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Studio"(id, slug, name) VALUES (%s, %s, %s)',
                (self.studio_id, self.studio_id, "pytest studio"),
            )
            cur.execute(
                '''INSERT INTO "Event"(id, "studioId", slug, title, theme, "updatedAt")
                   VALUES (%s, %s, %s, %s, 'LUXURY'::"ThemeKey", now())''',
                (self.event_id, self.studio_id, self.event_id, Jsonb({"en": "pytest"})),
            )

    def add_user(self) -> str:
        user_id = f"test-user-{uuid.uuid4().hex[:10]}"
        with self.conn.cursor() as cur:
            cur.execute('INSERT INTO "User"(id, "updatedAt") VALUES (%s, now())', (user_id,))
        self.user_ids.append(user_id)
        return user_id

    def add_photo(self) -> str:
        photo_id = new_id()
        with self.conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO "Photo"(id, "studioId", "eventId", "originalKey", "originalBytes",
                                       checksum, filename, status)
                   VALUES (%s, %s, %s, %s, 0, %s, %s, 'READY'::"PhotoStatus")''',
                (photo_id, self.studio_id, self.event_id, f"orig/{photo_id}.jpg", photo_id, f"{photo_id}.jpg"),
            )
        return photo_id

    def add_face(self, photo_id: str, embedding: list[float], quality: float = 0.9) -> str:
        face_id = new_id()
        with self.conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO "Face"(id, "eventId", "photoId", bbox, quality, "modelVersion", embedding)
                   VALUES (%s, %s, %s, %s, %s, 'pytest', %s::vector)''',
                (face_id, self.event_id, photo_id, Jsonb({"x": 0, "y": 0, "w": 1, "h": 1}), quality,
                 vec_literal(embedding)),
            )
        return face_id

    def cleanup(self) -> None:
        e, s = self.event_id, self.studio_id
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "PhotoMatch" pm USING "Photo" p WHERE pm."photoId" = p.id AND p."eventId" = %s', (e,))
            cur.execute('DELETE FROM "Face" WHERE "eventId" = %s', (e,))
            cur.execute('DELETE FROM "FaceCluster" WHERE "eventId" = %s', (e,))
            cur.execute('DELETE FROM "Photo" WHERE "eventId" = %s', (e,))
            cur.execute('DELETE FROM "ZipExport" WHERE "eventId" = %s', (e,))
            cur.execute('DELETE FROM "AuditLog" WHERE "eventId" = %s OR "studioId" = %s', (e, s))
            cur.execute('DELETE FROM "Event" WHERE id = %s', (e,))
            cur.execute('DELETE FROM "Studio" WHERE id = %s', (s,))
            cur.execute('DELETE FROM "User" WHERE id = ANY(%s)', (self.user_ids,))


@pytest.fixture
def tenant(conn):
    """A private studio + event for tests that write tenant-owned rows; removed afterwards."""
    t = Tenant(conn)
    yield t
    t.cleanup()
