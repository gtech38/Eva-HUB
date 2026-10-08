"""Job queue consumer backed by the Prisma `Job` table.

State machine (per row):

    QUEUED --claim (FOR UPDATE SKIP LOCKED)--> RUNNING
    RUNNING --handler returned--> SUCCEEDED
    RUNNING --handler returned Requeue(d)--> QUEUED  (runAt = now()+d, attempt not counted)
    RUNNING --handler raised, attempts <  maxAttempts--> QUEUED  (runAt = now()+backoff, lastError set)
    RUNNING --handler raised, attempts >= maxAttempts--> DEAD    (lastError set)
    RUNNING --lock older than STALE_LOCK_S (crashed worker)--> QUEUED

`runAt` gates everything, so delayed jobs and "scheduler ticks" are just rows
with a future runAt; the same 1 s poll loop serves both.

Note on FAILED: a retryable failure is parked as QUEUED with a future runAt
and a non-null lastError (so the admin UI can show "failed, retrying in …").
We never rest in FAILED because the claim query only picks QUEUED.

Handlers have the signature `handler(conn, job) -> None | Requeue`, where
`conn` is an autocommit psycopg connection; use `with conn.transaction():`
for atomic sections.
"""
from __future__ import annotations

import logging
import random
import threading
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Mapping

import psycopg

from .config import settings
from .db import connect, jsonb, utcnow

log = logging.getLogger(__name__)

JOB_TYPES = (
    "PROCESS_PHOTO", "INDEX_FACES", "CLUSTER_FACES", "BUILD_ZIP",
    "SEND_MESSAGE", "FIRE_REMINDER", "PURGE_FACE_INDEX", "PRINT_SUBMIT",
)

STALE_LOCK_S = 60 * 60       # RUNNING rows locked longer than this are re-queued (BUILD_ZIP can be slow)
BACKOFF_BASE_S = 10.0
BACKOFF_MAX_S = 3600.0


@dataclass
class Requeue:
    """Return from a handler to put the job back in the queue without counting a failure."""
    delay_s: float
    reason: str = ""


Handler = Callable[[psycopg.Connection, Mapping[str, Any]], Any]


def backoff_seconds(attempts: int) -> float:
    """Exponential backoff with +-25% jitter: 10s, 20s, 40s, ... capped at 1h."""
    base = min(BACKOFF_MAX_S, BACKOFF_BASE_S * (2 ** max(0, attempts - 1)))
    return base * random.uniform(0.75, 1.25)


# ── enqueue ───────────────────────────────────────────────────────────

def enqueue(
    conn: psycopg.Connection,
    job_type: str,
    payload: Mapping[str, Any],
    *,
    dedupe_key: str | None = None,
    run_at: datetime | None = None,
    delay_s: float = 0.0,
    max_attempts: int = 5,
) -> int | None:
    """Insert a job. With `dedupe_key`:

    * no row with that key                 -> inserted
    * existing row QUEUED                  -> payload refreshed, runAt pushed to the later of the two
    * existing row SUCCEEDED / DEAD / FAILED -> reset to QUEUED (re-run)
    * existing row RUNNING                 -> left alone (returns None); the handler
                                              is expected to detect late arrivals and Requeue itself
    """
    if run_at is None:
        run_at = utcnow() + timedelta(seconds=delay_s)
    with conn.cursor() as cur:
        if dedupe_key is None:
            cur.execute(
                'INSERT INTO "Job"(type, payload, status, "runAt", "maxAttempts") '
                'VALUES (%s, %s, \'QUEUED\'::"JobStatus", %s, %s) RETURNING id',
                (job_type, jsonb(dict(payload)), run_at, max_attempts),
            )
        else:
            cur.execute(
                '''
                INSERT INTO "Job"(type, payload, status, "runAt", "maxAttempts", "dedupeKey")
                VALUES (%s, %s, 'QUEUED'::"JobStatus", %s, %s, %s)
                ON CONFLICT ("dedupeKey") DO UPDATE SET
                    payload     = EXCLUDED.payload,
                    status      = 'QUEUED'::"JobStatus",
                    "runAt"     = CASE WHEN "Job".status = 'QUEUED'::"JobStatus"
                                       THEN GREATEST("Job"."runAt", EXCLUDED."runAt")
                                       ELSE EXCLUDED."runAt" END,
                    attempts    = CASE WHEN "Job".status = 'QUEUED'::"JobStatus" THEN "Job".attempts ELSE 0 END,
                    "lastError" = NULL,
                    "lockedBy"  = NULL,
                    "lockedAt"  = NULL
                WHERE "Job".status <> 'RUNNING'::"JobStatus"
                RETURNING id
                ''',
                (job_type, jsonb(dict(payload)), run_at, max_attempts, dedupe_key),
            )
        row = cur.fetchone()
        return int(row["id"]) if row else None


# ── claim / finish ────────────────────────────────────────────────────

CLAIM_SQL = '''
UPDATE "Job"
   SET status = 'RUNNING'::"JobStatus",
       "lockedBy" = %s,
       "lockedAt" = now(),
       attempts = attempts + 1
 WHERE id = (
       SELECT id FROM "Job"
        WHERE status = 'QUEUED'::"JobStatus" AND "runAt" <= now()
          AND (%s::text[] IS NULL OR type = ANY(%s::text[]))
        ORDER BY "runAt", id
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
RETURNING *
'''


def claim(conn: psycopg.Connection, worker_id: str, only_types: list[str] | None = None) -> dict | None:
    """Claim one due job (optionally restricted to `only_types`, e.g. a worker that only builds zips)."""
    with conn.cursor() as cur:
        cur.execute(CLAIM_SQL, (worker_id, only_types, only_types))
        return cur.fetchone()


def mark_succeeded(conn: psycopg.Connection, job_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            'UPDATE "Job" SET status = \'SUCCEEDED\'::"JobStatus", "lastError" = NULL WHERE id = %s',
            (job_id,),
        )


def mark_requeued(conn: psycopg.Connection, job_id: int, delay_s: float, reason: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            '''UPDATE "Job"
                  SET status = 'QUEUED'::"JobStatus",
                      "runAt" = now() + make_interval(secs => %s),
                      attempts = GREATEST(attempts - 1, 0),
                      "lockedBy" = NULL, "lockedAt" = NULL,
                      "lastError" = %s
                WHERE id = %s''',
            (float(delay_s), f"requeued: {reason}" if reason else None, job_id),
        )


def mark_failed(conn: psycopg.Connection, job: Mapping[str, Any], error: str) -> str:
    """Retry with backoff while attempts < maxAttempts, else DEAD. Returns the new status."""
    attempts = int(job["attempts"])
    max_attempts = int(job["maxAttempts"])
    error = error[-4000:]
    with conn.cursor() as cur:
        if attempts < max_attempts:
            delay = backoff_seconds(attempts)
            cur.execute(
                '''UPDATE "Job"
                      SET status = 'QUEUED'::"JobStatus",
                          "runAt" = now() + make_interval(secs => %s),
                          "lastError" = %s,
                          "lockedBy" = NULL, "lockedAt" = NULL
                    WHERE id = %s''',
                (float(delay), error, job["id"]),
            )
            return "QUEUED"
        cur.execute(
            '''UPDATE "Job"
                  SET status = 'DEAD'::"JobStatus", "lastError" = %s,
                      "lockedBy" = NULL, "lockedAt" = NULL
                WHERE id = %s''',
            (error, job["id"]),
        )
        return "DEAD"


def requeue_stale(conn: psycopg.Connection, older_than_s: float = STALE_LOCK_S) -> int:
    """Return RUNNING jobs whose worker vanished to the queue. Counts as a failed attempt."""
    with conn.cursor() as cur:
        cur.execute(
            '''UPDATE "Job"
                  SET status = CASE WHEN attempts >= "maxAttempts" THEN 'DEAD'::"JobStatus" ELSE 'QUEUED'::"JobStatus" END,
                      "lastError" = 'stale lock released (worker ' || COALESCE("lockedBy", '?') || ')',
                      "lockedBy" = NULL, "lockedAt" = NULL
                WHERE status = 'RUNNING'::"JobStatus"
                  AND "lockedAt" < now() - make_interval(secs => %s)''',
            (float(older_than_s),),
        )
        return cur.rowcount


# ── dispatch ──────────────────────────────────────────────────────────

def default_handlers() -> dict[str, Handler]:
    from .handlers import build_zip, cluster_faces, fire_reminder, index_faces, print_submit, process_photo, purge_face_index, send_message
    return {
        "PROCESS_PHOTO": process_photo.handle,
        "INDEX_FACES": index_faces.handle,
        "CLUSTER_FACES": cluster_faces.handle,
        "BUILD_ZIP": build_zip.handle,
        "SEND_MESSAGE": send_message.handle,
        "FIRE_REMINDER": fire_reminder.handle,
        "PURGE_FACE_INDEX": purge_face_index.handle,
        "PRINT_SUBMIT": print_submit.handle,
    }


def run_once(
    conn: psycopg.Connection,
    handlers: Mapping[str, Handler],
    worker_id: str | None = None,
    only_types: list[str] | None = None,
) -> dict | None:
    """Claim and run at most one job. Returns the claimed job row (or None if the queue was empty).

    `conn` must be in autocommit mode. `only_types` restricts which job types this call may claim.
    """
    worker_id = worker_id or settings.worker_id
    job = claim(conn, worker_id, only_types)
    if job is None:
        return None
    job_id = int(job["id"])
    job_type = job["type"]
    t0 = time.perf_counter()
    handler = handlers.get(job_type)
    try:
        if handler is None:
            raise LookupError(f"no handler registered for job type {job_type!r}")
        result = handler(conn, job)
        if isinstance(result, Requeue):
            mark_requeued(conn, job_id, result.delay_s, result.reason)
            log.info("job %s %s requeued in %.0fs (%s)", job_id, job_type, result.delay_s, result.reason)
        else:
            mark_succeeded(conn, job_id)
            log.info("job %s %s succeeded in %.0f ms", job_id, job_type, (time.perf_counter() - t0) * 1000)
    except Exception as exc:  # noqa: BLE001 - we want every failure recorded on the row
        err = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        try:
            if conn.info.transaction_status != psycopg.pq.TransactionStatus.IDLE:
                conn.rollback()
            status = mark_failed(conn, job, err)
        except Exception:  # pragma: no cover - DB itself is broken
            log.exception("could not record failure for job %s", job_id)
            raise
        log.warning("job %s %s failed (attempt %s/%s) -> %s: %s", job_id, job_type, job["attempts"], job["maxAttempts"], status, exc)
    return job


def consume_forever(
    handlers: Mapping[str, Handler] | None = None,
    stop: threading.Event | None = None,
    poll_interval_s: float | None = None,
) -> None:
    """Poll loop: claim+run until the queue is empty, then sleep ~1 s with jitter."""
    handlers = handlers or default_handlers()
    stop = stop or threading.Event()
    poll = poll_interval_s if poll_interval_s is not None else settings.poll_interval_s
    conn = connect(autocommit=True)
    last_housekeeping = 0.0
    log.info("consumer %s started; handlers: %s", settings.worker_id, ", ".join(sorted(handlers)))
    while not stop.is_set():
        try:
            if conn.closed:
                conn = connect(autocommit=True)
            now = time.monotonic()
            if now - last_housekeeping > 60:
                n = requeue_stale(conn)
                if n:
                    log.warning("released %d stale RUNNING job(s)", n)
                last_housekeeping = now
            ran = run_once(conn, handlers)
            if ran is not None:
                continue  # drain without sleeping
        except psycopg.OperationalError as exc:
            log.error("database error: %s; reconnecting", exc)
            try:
                conn.close()
            except Exception:
                pass
            stop.wait(min(30.0, poll * 5))
            continue
        stop.wait(poll * random.uniform(0.7, 1.3))
    conn.close()
    log.info("consumer stopped")
