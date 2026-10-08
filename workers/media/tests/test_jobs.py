"""Consumer semantics against the real local Postgres (skipped if unreachable).

Isolation (WRK-011): every test gets its own job type (`TEST_<LABEL>_<uuid8>`) from the `queue`
fixture (tests/conftest.py), claims with `only_types=[that type]`, asserts that the claimed row is
the one it enqueued (by id), and every row enqueued during the test is deleted when it finishes.
A leftover row from an earlier test or a killed run, or a parallel copy of this module, cannot be
claimed here. The suite must NOT share a database with a running consumer (`make dev` /
`make consume`): a consumer without `only_types` claims every due row, TEST_* ones included.

Why `queue.run_job()` polls briefly: `enqueue()` stamps `runAt` from the client clock and Postgres
rounds it to timestamp(3), so on a fast runner a delay-0 job can still be ~0.5 ms in the future when
the test claims it a moment later. The CI flake in PR #117 was exactly that: the row was not due
yet, stayed QUEUED, and the next test's single claim picked it up instead of its own row.
`queue.due_now()` pins the other side: delay 0 must still mean "due within 1 ms".
"""
from __future__ import annotations

from datetime import timedelta

from hub_worker import jobs
from hub_worker.handlers import cluster_faces
from hub_worker.db import utcnow

TEN_YEARS_AGO = "now() - interval '10 years'"
NINE_YEARS_S = 9 * 365 * 86400
MARK_RUNNING = """UPDATE "Job" SET status = 'RUNNING'::"JobStatus", "lockedAt" = now()
                   WHERE id = %s"""


def test_noop_job_succeeds(queue):
    seen = []
    handlers = {queue.type: lambda c, j: seen.append(j["payload"]["x"])}
    job_id = queue.enqueue({"x": 42})
    assert queue.due_now(job_id), "delay 0 must mean due now"
    queue.run_job(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "SUCCEEDED"
    assert row["attempts"] == 1 and row["lockedBy"] == "pytest" and row["lastError"] is None
    assert seen == [42]


def test_failing_job_backs_off_then_dies(queue, conn):
    def boom(c, j):
        raise RuntimeError("kaboom")

    handlers = {queue.type: boom}
    job_id = queue.enqueue(max_attempts=2)

    queue.run_job(handlers, job_id)
    row = queue.row(job_id)
    # attempt 1 of 2: parked back in the queue with a future runAt and the error recorded
    assert row["status"] == "QUEUED"
    assert row["attempts"] == 1
    assert row["future"] is True
    assert "kaboom" in row["lastError"] and "RuntimeError" in row["lastError"]
    assert row["lockedBy"] is None

    # not due yet -> not claimable
    assert queue.run_next(handlers) is None

    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET "runAt" = now() WHERE id = %s', (job_id,))
    queue.run_job(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "DEAD" and row["attempts"] == 2 and "kaboom" in row["lastError"]
    # dead jobs are never claimed again
    assert queue.run_next(handlers) is None


def test_unknown_type_is_a_failure(queue):
    job_id = queue.enqueue(max_attempts=1)
    queue.run_job({}, job_id)  # no handler registered
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
    queue.run_job(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "QUEUED" and row["attempts"] == 0
    assert row["lastError"].startswith("requeued")
    assert queue.due_now(job_id), "Requeue(0) must mean due now"
    queue.run_job(handlers, job_id)
    row = queue.row(job_id)
    assert row["status"] == "SUCCEEDED" and row["attempts"] == 1 and len(calls) == 2


def test_dedupe_key_semantics(queue, conn):
    key = f"test:{queue.type}"
    a = queue.enqueue({"v": 1}, dedupe_key=key, delay_s=60)
    b = queue.enqueue({"v": 2}, dedupe_key=key, delay_s=120)
    assert a == b  # same row, refreshed
    row = queue.row(a)
    assert row["payload"] == {"v": 2} and row["status"] == "QUEUED"

    # make it due, run it, then re-enqueue: a SUCCEEDED row is reset to QUEUED
    with conn.cursor() as cur:
        cur.execute('UPDATE "Job" SET "runAt" = now() WHERE id = %s', (a,))
    queue.run_job({queue.type: lambda c, j: None}, a)
    assert queue.row(a)["status"] == "SUCCEEDED"
    c = queue.enqueue({"v": 3}, dedupe_key=key)
    row = queue.row(a)
    assert c == a and row["status"] == "QUEUED"
    assert row["attempts"] == 0 and row["payload"] == {"v": 3}

    # while RUNNING the enqueue is a no-op
    with conn.cursor() as cur:
        cur.execute(MARK_RUNNING, (a,))
    assert queue.enqueue({"v": 4}, dedupe_key=key) is None
    assert queue.row(a)["payload"] == {"v": 3}


def test_stale_lock_release(queue, conn):
    # requeue_stale() has no type filter (WRK-016): lock 10 years back and only release locks
    # older than 9 years, so no real job is touched; serialise parallel copies of this test so one
    # copy cannot release the other's row between its UPDATE and its assertions.
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(hashtext('test_stale_lock_release'))")
    try:
        job_id = queue.enqueue(delay_s=3600)  # never due, so no consumer could claim it meanwhile
        with conn.cursor() as cur:
            cur.execute(
                f"""UPDATE "Job" SET status = 'RUNNING'::"JobStatus", attempts = 1,
                           "lockedBy" = 'dead-worker', "lockedAt" = {TEN_YEARS_AGO}
                     WHERE id = %s""",
                (job_id,),
            )
        assert jobs.requeue_stale(conn, older_than_s=NINE_YEARS_S) >= 1
        row = queue.row(job_id)
        assert row["status"] == "QUEUED" and row["lockedBy"] is None and "stale" in row["lastError"]
    finally:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(hashtext('test_stale_lock_release'))")


def test_claims_only_rows_it_created(queue):
    """WRK-011 regression: a due row of another type (an earlier test's job) is never claimed."""
    five_min_ago = utcnow() - timedelta(minutes=5)
    stray = jobs.enqueue(queue.conn, f"{queue.type}_OTHER", {}, run_at=five_min_ago)
    own = queue.enqueue()
    queue.run_job({queue.type: lambda c, j: None}, own)
    row = queue.row(stray)
    assert row["status"] == "QUEUED" and row["attempts"] == 0 and row["lockedBy"] is None


def test_own_row_is_claimed_when_runat_lands_just_after_db_now(queue):
    """WRK-011 regression: enqueue() stamps runAt from the client clock and Postgres rounds it to
    timestamp(3), so on a fast runner a delay-0 job can be ~0.5 ms in the future at claim time."""
    own = queue.enqueue(delay_s=0.02)
    queue.run_job({queue.type: lambda c, j: None}, own)
    assert queue.row(own)["status"] == "SUCCEEDED"


def test_cleanup_leaves_no_row_the_test_created(queue, conn):
    """WRK-011: every row created during a test (any type, any state) is tracked and removed."""
    due = queue.enqueue()
    later = queue.enqueue(delay_s=3600)
    running = queue.enqueue()
    with conn.cursor() as cur:
        cur.execute(MARK_RUNNING, (running,))
    # a bare jobs.enqueue of a foreign type is tracked too
    foreign = jobs.enqueue(conn, f"{queue.type}_OTHER", {}, delay_s=3600)
    created = [due, later, running, foreign]
    assert set(created) <= set(queue.ids)
    queue.cleanup()
    with conn.cursor() as cur:
        cur.execute('SELECT id FROM "Job" WHERE id = ANY(%s)', (created,))
        assert cur.fetchall() == []


def test_backoff_grows_and_caps():
    assert 7 <= jobs.backoff_seconds(1) <= 13
    assert 15 <= jobs.backoff_seconds(2) <= 25
    assert jobs.backoff_seconds(50) <= jobs.BACKOFF_MAX_S * 1.25


def test_cluster_faces_job_inserts_face_cluster_with_timestamps(queue, conn, tenant):
    """DB-001: a FaceCluster created through the CLUSTER_FACES handler has createdAt/updatedAt.

    Prisma's @updatedAt has no column default, so the worker's raw INSERT must set it.
    """
    a = [1.0] + [0.0] * 127
    b = [0.99, 0.1] + [0.0] * 126  # cosine ~0.995 to `a`: one cluster
    for emb in (a, b):
        tenant.add_face(tenant.add_photo(), emb)

    job_id = queue.enqueue({"eventId": tenant.event_id})
    queue.run_job({queue.type: cluster_faces.handle}, job_id)

    row = queue.row(job_id)
    assert row["status"] == "SUCCEEDED", row["lastError"]
    with conn.cursor() as cur:
        cur.execute(
            '''SELECT "createdAt", "updatedAt", now() AT TIME ZONE 'UTC' AS db_now
                 FROM "FaceCluster" WHERE "eventId" = %s''',
            (tenant.event_id,),
        )
        clusters = cur.fetchall()
    assert len(clusters) == 1
    c = clusters[0]
    assert c["updatedAt"] is not None and c["createdAt"] is not None
    assert c["createdAt"] == c["updatedAt"]
    assert abs(c["updatedAt"] - c["db_now"]) < timedelta(minutes=1)
