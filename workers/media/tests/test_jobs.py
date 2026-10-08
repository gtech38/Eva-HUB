"""Consumer semantics against the real local Postgres (skipped if unreachable).

Only TEST_* job types are claimed, so a web/admin dev server enqueueing real
jobs at the same time is unaffected.
"""
from __future__ import annotations

import time
import uuid

import psycopg
import pytest

from hub_worker import jobs
from hub_worker.db import connect

TYPES = ["TEST_NOOP", "TEST_FAIL", "TEST_REQUEUE", "TEST_DEDUPE"]


@pytest.fixture(scope="module")
def conn():
    try:
        c = connect(autocommit=True)
    except psycopg.OperationalError as exc:  # pragma: no cover
        pytest.skip(f"postgres not reachable: {exc}")
    yield c
    with c.cursor() as cur:
        cur.execute('DELETE FROM "Job" WHERE type = ANY(%s)', (TYPES,))
    c.close()


def _job(conn, job_id):
    with conn.cursor() as cur:
        cur.execute('SELECT *, "runAt" > now() AS future FROM "Job" WHERE id = %s', (job_id,))
        return cur.fetchone()


def _drain(conn, handlers, n=20):
    ran = []
    for _ in range(n):
        j = jobs.run_once(conn, handlers, worker_id="pytest", only_types=TYPES)
        if j is None:
            break
        ran.append(int(j["id"]))
    return ran


def test_noop_job_succeeds(conn):
    seen = []
    handlers = {"TEST_NOOP": lambda c, j: seen.append(j["payload"]["x"])}
    job_id = jobs.enqueue(conn, "TEST_NOOP", {"x": 42})
    assert job_id in _drain(conn, handlers)
    row = _job(conn, job_id)
    assert row["status"] == "SUCCEEDED"
    assert row["attempts"] == 1 and row["lockedBy"] == "pytest" and row["lastError"] is None
    assert seen == [42]


def test_failing_job_backs_off_then_dies(conn):
    def boom(c, j):
        raise RuntimeError("kaboom")

    handlers = {"TEST_FAIL": boom}
    job_id = jobs.enqueue(conn, "TEST_FAIL", {}, max_attempts=2)

    assert job_id in _drain(conn, handlers)
    row = _job(conn, job_id)
    # attempt 1 of 2: parked back in the queue with a future runAt and the error recorded
    assert row["status"] == "QUEUED"
    assert row["attempts"] == 1
    assert row["future"] is True
    assert "kaboom" in row["lastError"] and "RuntimeError" in row["lastError"]
    assert row["lockedBy"] is None

    # not due yet -> not claimable
    assert job_id not in _drain(conn, handlers)

    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET "runAt" = now() WHERE id = %s', (job_id,))
    assert job_id in _drain(conn, handlers)
    row = _job(conn, job_id)
    assert row["status"] == "DEAD" and row["attempts"] == 2 and "kaboom" in row["lastError"]
    # dead jobs are never claimed again
    assert job_id not in _drain(conn, handlers)


def test_unknown_type_is_a_failure(conn):
    job_id = jobs.enqueue(conn, "TEST_NOOP", {}, max_attempts=1)
    _drain(conn, {})  # no handler registered
    row = _job(conn, job_id)
    assert row["status"] == "DEAD" and "no handler" in row["lastError"]


def test_requeue_does_not_count_as_attempt(conn):
    calls = []

    def handler(c, j):
        calls.append(1)
        if len(calls) == 1:
            return jobs.Requeue(0.0, "once more")
        return None

    job_id = jobs.enqueue(conn, "TEST_REQUEUE", {})
    _drain(conn, {"TEST_REQUEUE": handler}, n=1)
    row = _job(conn, job_id)
    assert row["status"] == "QUEUED" and row["attempts"] == 0 and row["lastError"].startswith("requeued")
    time.sleep(0.05)
    _drain(conn, {"TEST_REQUEUE": handler})
    row = _job(conn, job_id)
    assert row["status"] == "SUCCEEDED" and row["attempts"] == 1 and len(calls) == 2


def test_dedupe_key_semantics(conn):
    key = f"test:{uuid.uuid4()}"
    a = jobs.enqueue(conn, "TEST_DEDUPE", {"v": 1}, dedupe_key=key, delay_s=60)
    b = jobs.enqueue(conn, "TEST_DEDUPE", {"v": 2}, dedupe_key=key, delay_s=120)
    assert a == b  # same row, refreshed
    row = _job(conn, a)
    assert row["payload"] == {"v": 2} and row["status"] == "QUEUED"

    # make it due, run it, then re-enqueue: a SUCCEEDED row is reset to QUEUED
    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET "runAt" = now() WHERE id = %s', (a,))
    _drain(conn, {"TEST_DEDUPE": lambda c, j: None})
    assert _job(conn, a)["status"] == "SUCCEEDED"
    c = jobs.enqueue(conn, "TEST_DEDUPE", {"v": 3}, dedupe_key=key)
    row = _job(conn, a)
    assert c == a and row["status"] == "QUEUED" and row["attempts"] == 0 and row["payload"] == {"v": 3}

    # while RUNNING the enqueue is a no-op
    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET status = \'RUNNING\'::"JobStatus", "lockedAt" = now() WHERE id = %s', (a,))
    assert jobs.enqueue(conn, "TEST_DEDUPE", {"v": 4}, dedupe_key=key) is None
    assert _job(conn, a)["payload"] == {"v": 3}


def test_stale_lock_release(conn):
    job_id = jobs.enqueue(conn, "TEST_NOOP", {})
    with conn.cursor() as cur:
        cur.execute(
            '''UPDATE "Job" SET status = 'RUNNING'::"JobStatus", attempts = 1,
                      "lockedBy" = 'dead-worker', "lockedAt" = now() - interval '2 hours' WHERE id = %s''',
            (job_id,),
        )
    assert jobs.requeue_stale(conn, older_than_s=3600) >= 1
    row = _job(conn, job_id)
    assert row["status"] == "QUEUED" and row["lockedBy"] is None and "stale" in row["lastError"]


def test_backoff_grows_and_caps():
    assert 7 <= jobs.backoff_seconds(1) <= 13
    assert 15 <= jobs.backoff_seconds(2) <= 25
    assert jobs.backoff_seconds(50) <= jobs.BACKOFF_MAX_S * 1.25
