"""Consumer semantics against the real local Postgres (skipped if unreachable).

Isolation (WRK-011): every test gets its own job type (`TEST_<LABEL>_<uuid8>`) from the `queue`
fixture, claims with `only_types=[that type]`, asserts that the claimed row is the one it
enqueued (by id), and deletes its rows when it finishes. A web/admin dev server enqueueing real
jobs, a leftover row from an earlier test or run, or a parallel test run cannot be claimed here,
and nothing this module creates survives the test that created it.

Why `queue.run()` polls: `enqueue()` stamps `runAt` from the client clock and Postgres rounds it
to timestamp(3), so on a fast runner a delay-0 job can still be ~0.5 ms in the future when the
test claims it a moment later. The CI flake in PR #117 was exactly that: the row was not due yet,
stayed QUEUED, and the next test's single claim picked it up instead of its own row.
"""
from __future__ import annotations

import time
import uuid
from datetime import timedelta
from typing import Any, Callable, Mapping

import psycopg
import pytest

from hub_worker import jobs
from hub_worker.db import connect, utcnow

WORKER_ID = "pytest"
CLAIM_TIMEOUT_S = 2.0


@pytest.fixture(scope="module")
def conn():
    try:
        c = connect(autocommit=True)
    except psycopg.OperationalError as exc:  # pragma: no cover
        pytest.skip(f"postgres not reachable: {exc}")
    yield c
    c.close()


class OwnQueue:
    """One test's private slice of the Job table."""

    def __init__(self, conn: psycopg.Connection, label: str) -> None:
        self.conn = conn
        self.type = f"TEST_{label}_{uuid.uuid4().hex[:8]}"
        self.ids: list[int] = []

    def track(self, job_id: int | None) -> int | None:
        if job_id is not None and job_id not in self.ids:
            self.ids.append(job_id)
        return job_id

    def enqueue(self, payload: Mapping[str, Any] | None = None, **kw: Any) -> int | None:
        return self.track(jobs.enqueue(self.conn, self.type, payload or {}, **kw))

    def claim_once(self, handlers: Mapping[str, Callable]) -> dict | None:
        """One `run_once` restricted to this test's type; None when nothing of ours is due."""
        return jobs.run_once(self.conn, handlers, worker_id=WORKER_ID, only_types=[self.type])

    def run(self, handlers: Mapping[str, Callable], job_id: int) -> dict:
        """Claim and run `job_id`, waiting (bounded) for it to become due. Asserts the id."""
        deadline = time.monotonic() + CLAIM_TIMEOUT_S
        while (job := self.claim_once(handlers)) is None:
            assert time.monotonic() < deadline, f"job {job_id} ({self.type}) never became claimable"
            time.sleep(0.002)
        assert int(job["id"]) == job_id, f"claimed job {job['id']}, expected {job_id}"
        return job

    def row(self, job_id: int) -> dict:
        with self.conn.cursor() as cur:
            cur.execute('SELECT *, "runAt" > now() AS future FROM "Job" WHERE id = %s', (job_id,))
            return cur.fetchone()

    def cleanup(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "Job" WHERE type = %s OR id = ANY(%s)', (self.type, self.ids))


@pytest.fixture
def queue(conn, request):
    q = OwnQueue(conn, request.node.name.removeprefix("test_")[:24].upper())
    yield q
    q.cleanup()


def test_noop_job_succeeds(queue):
    seen = []
    handlers = {queue.type: lambda c, j: seen.append(j["payload"]["x"])}
    job_id = queue.enqueue({"x": 42})
    queue.run(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "SUCCEEDED"
    assert row["attempts"] == 1 and row["lockedBy"] == WORKER_ID and row["lastError"] is None
    assert seen == [42]


def test_failing_job_backs_off_then_dies(queue, conn):
    def boom(c, j):
        raise RuntimeError("kaboom")

    handlers = {queue.type: boom}
    job_id = queue.enqueue(max_attempts=2)

    queue.run(handlers, job_id)
    row = queue.row(job_id)
    # attempt 1 of 2: parked back in the queue with a future runAt and the error recorded
    assert row["status"] == "QUEUED"
    assert row["attempts"] == 1
    assert row["future"] is True
    assert "kaboom" in row["lastError"] and "RuntimeError" in row["lastError"]
    assert row["lockedBy"] is None

    # not due yet -> not claimable
    assert queue.claim_once(handlers) is None

    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET "runAt" = now() WHERE id = %s', (job_id,))
    queue.run(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "DEAD" and row["attempts"] == 2 and "kaboom" in row["lastError"]
    # dead jobs are never claimed again
    assert queue.claim_once(handlers) is None


def test_unknown_type_is_a_failure(queue):
    job_id = queue.enqueue(max_attempts=1)
    queue.run({}, job_id)  # no handler registered
    row = queue.row(job_id)
    assert row["status"] == "DEAD" and "no handler" in row["lastError"]


def test_requeue_does_not_count_as_attempt(queue):
    calls = []

    def handler(c, j):
        calls.append(1)
        if len(calls) == 1:
            return jobs.Requeue(0.0, "once more")
        return None

    handlers = {queue.type: handler}
    job_id = queue.enqueue()
    queue.run(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "QUEUED" and row["attempts"] == 0 and row["lastError"].startswith("requeued")
    queue.run(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "SUCCEEDED" and row["attempts"] == 1 and len(calls) == 2


def test_dedupe_key_semantics(queue, conn):
    key = f"test:{uuid.uuid4()}"
    a = queue.enqueue({"v": 1}, dedupe_key=key, delay_s=60)
    b = queue.enqueue({"v": 2}, dedupe_key=key, delay_s=120)
    assert a == b  # same row, refreshed
    row = queue.row(a)
    assert row["payload"] == {"v": 2} and row["status"] == "QUEUED"

    # make it due, run it, then re-enqueue: a SUCCEEDED row is reset to QUEUED
    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET "runAt" = now() WHERE id = %s', (a,))
    queue.run({queue.type: lambda c, j: None}, a)
    assert queue.row(a)["status"] == "SUCCEEDED"
    c = queue.enqueue({"v": 3}, dedupe_key=key)
    row = queue.row(a)
    assert c == a and row["status"] == "QUEUED" and row["attempts"] == 0 and row["payload"] == {"v": 3}

    # while RUNNING the enqueue is a no-op
    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET status = \'RUNNING\'::"JobStatus", "lockedAt" = now() WHERE id = %s', (a,))
    assert queue.enqueue({"v": 4}, dedupe_key=key) is None
    assert queue.row(a)["payload"] == {"v": 3}


def test_stale_lock_release(queue, conn):
    job_id = queue.enqueue()
    with conn.cursor() as cur:
        cur.execute(
            '''UPDATE "Job" SET status = 'RUNNING'::"JobStatus", attempts = 1,
                      "lockedBy" = 'dead-worker', "lockedAt" = now() - interval '2 hours' WHERE id = %s''',
            (job_id,),
        )
    assert jobs.requeue_stale(conn, older_than_s=3600) >= 1
    row = queue.row(job_id)
    assert row["status"] == "QUEUED" and row["lockedBy"] is None and "stale" in row["lastError"]


def test_claims_only_rows_it_created(queue):
    """WRK-011 regression: a due leftover TEST_* row (e.g. an earlier test's job) must not be claimed."""
    stray = queue.track(jobs.enqueue(queue.conn, "TEST_NOOP", {"stray": True}, run_at=utcnow() - timedelta(minutes=5)))
    own = queue.enqueue()
    queue.run({queue.type: lambda c, j: None}, own)
    row = queue.row(stray)
    assert row["status"] == "QUEUED" and row["attempts"] == 0 and row["lockedBy"] is None


def test_own_row_is_claimed_when_runat_lands_just_after_db_now(queue):
    """WRK-011 regression: enqueue() stamps runAt from the client clock and Postgres rounds it to
    timestamp(3), so on a fast runner a delay-0 job can be ~0.5 ms in the future at claim time."""
    own = queue.enqueue(delay_s=0.02)
    queue.run({queue.type: lambda c, j: None}, own)
    assert queue.row(own)["status"] == "SUCCEEDED"


def test_cleanup_leaves_no_row_the_test_created(conn):
    """WRK-011: per-test teardown removes every row a test created, whatever state it ended in."""
    q = OwnQueue(conn, "CLEANUP")
    due = q.enqueue()
    later = q.enqueue(delay_s=3600)
    running = q.enqueue()
    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET status = \'RUNNING\'::"JobStatus", "lockedAt" = now() WHERE id = %s', (running,))
    stray = q.track(jobs.enqueue(conn, "TEST_NOOP", {"stray": True}, delay_s=3600))
    try:
        q.cleanup()
        with conn.cursor() as cur:
            cur.execute('SELECT id FROM "Job" WHERE type = %s OR id = ANY(%s)', (q.type, [due, later, running, stray]))
            assert cur.fetchall() == []
    finally:
        q.cleanup()


def test_backoff_grows_and_caps():
    assert 7 <= jobs.backoff_seconds(1) <= 13
    assert 15 <= jobs.backoff_seconds(2) <= 25
    assert jobs.backoff_seconds(50) <= jobs.BACKOFF_MAX_S * 1.25
