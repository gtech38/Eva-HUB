"""The SQL a restore operator runs (DOC-003): runbook blocks, the AuditLog export from the old
instance and the replay on the new one. Executed against a real database, inside transactions
that are rolled back, never on a database named hub. Text-only drift checks are in
test_restore_contracts.py.
"""
from __future__ import annotations

import csv
import io
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from _drill_env import (  # noqa: F401 - make_source is a fixture used by name
    ROOT,
    SOURCE,
    docker_net_and_host,
    make_source,
    psycopg,
    require_not_shared_hub,
)

RUNBOOK = ROOT / "docs" / "ops" / "runbook-restore.md"
REPLAY_SQL = ROOT / "docs" / "ops" / "replay-after-restore.sql"
EXPORT_SQL = ROOT / "docs" / "ops" / "replay-export.sql"
VEC = "[" + ",".join(["0"] * 128) + "]"


def _runbook_sql_blocks() -> list[str]:
    return re.findall(r"```sql\n(.*?)```", RUNBOOK.read_text(), re.S)


def _jobs(conn, type_: str, key: str, ids: list[str]) -> dict[str, tuple]:  # type: ignore[no-untyped-def]
    return {
        r[0]: r[1:]
        for r in conn.execute(
            f"SELECT payload->>'{key}', status::text, attempts, \"lockedBy\", \"lastError\", payload, \"runAt\" > now() + interval '1 hour'"
            ' FROM "Job" WHERE type = %s AND payload->>%s = ANY(%s)',
            (type_, key, ids),
        ).fetchall()
    }


def _status(conn, dedupe_key: str) -> tuple | None:  # type: ignore[no-untyped-def]
    return conn.execute('SELECT status::text, attempts FROM "Job" WHERE "dedupeKey" = %s', (dedupe_key,)).fetchone()


def test_runbook_sql_executes_and_requeues_like_the_worker_enqueue() -> None:
    require_not_shared_hub()
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
                    'INSERT INTO "Job"(type, payload, status, attempts, "lockedBy", "lockedAt", "lastError", "finishedAt", "runAt", "dedupeKey")'
                    f" VALUES ('PURGE_FACE_INDEX', %s::jsonb, %s::\"JobStatus\", 3, 'w1', now(), 'boom', now(), {run_at}, %s)",
                    (f'{{"eventId": "{eid}", "stale": true}}', status, f"purge-face:{eid}:restore"),
                )
            conn.execute(purge)
            rows = _jobs(conn, "PURGE_FACE_INDEX", "eventId", events)
            finished = dict(conn.execute(
                'SELECT payload->>\'eventId\', "finishedAt" IS NULL FROM "Job" WHERE type = \'PURGE_FACE_INDEX\' AND payload->>\'eventId\' = ANY(%s)',
                (events,),
            ).fetchall())
            # jobs.enqueue clears finishedAt on every re-queue (ADM-022); RUNNING is untouched
            assert finished == {events[0]: False, events[1]: True, events[2]: True}
            # RUNNING rows belong to a live worker: untouched (same rule as jobs.enqueue)
            assert rows[events[0]][:4] == ("RUNNING", 3, "w1", "boom")
            # finished/dead rows are reset: requeued with attempts 0, no stale lock or error, fresh payload
            assert rows[events[1]][:4] == ("QUEUED", 0, None, None)
            assert rows[events[1]][4] == {"eventId": events[1]}
            # QUEUED rows keep their attempts and the later runAt, get the fresh payload, lose the stale lock
            assert rows[events[2]][:4] == ("QUEUED", 3, None, None)
            assert rows[events[2]][4] == {"eventId": events[2]}
            assert rows[events[2]][5] is True, "runAt = GREATEST(existing, new): the later time is kept"
            for block in blocks:
                if block is not purge:
                    conn.execute(block)  # every other runbook SQL block is valid against the real schema
        finally:
            conn.rollback()


def _load_replay_audit(conn, rows: list[tuple]) -> None:  # type: ignore[no-untyped-def]
    """Same columns, order and types as the runbook's temp table and replay-export.sql's CSV."""
    conn.execute(
        'CREATE TEMP TABLE replay_audit (id bigint, action text, "eventId" text, target text, "createdAt" timestamp)'
    )
    for row in rows:
        conn.execute("INSERT INTO replay_audit VALUES (%s, %s, %s, %s, %s)", row)


def test_replay_re_applies_purges_toggles_and_photo_deletions_from_the_old_audit_log() -> None:
    require_not_shared_hub()
    with psycopg.connect(SOURCE) as conn:
        try:
            ev = [r[0] for r in conn.execute('SELECT id, "studioId" FROM "Event" ORDER BY id LIMIT 5').fetchall()]
            studio = conn.execute('SELECT "studioId" FROM "Event" WHERE id = %s', (ev[0],)).fetchone()[0]
            assert len(ev) == 5
            disabled, toggled_back, purged, requested, photos_event = ev
            conn.execute('UPDATE "Event" SET "faceSearchEnabled" = true WHERE id = ANY(%s)', (ev,))
            conn.execute('UPDATE "Event" SET "faceSearchEnabled" = false WHERE id = %s', (toggled_back,))
            # photos: one in the purged event (with indexing jobs in flight), one deleted after T elsewhere
            for pid, eid in (("p_purged", purged), ("p_deleted", photos_event)):
                conn.execute(
                    'INSERT INTO "Photo"(id, "studioId", "eventId", "originalKey", "originalBytes", checksum, filename)'
                    " VALUES (%s, %s, %s, 'k', 1, %s, 'f.jpg')",
                    (pid, studio, eid, pid),
                )
            conn.execute(
                'INSERT INTO "Face"(id, "eventId", "photoId", bbox, quality, "modelVersion", embedding)'
                " VALUES ('f_deleted', %s, 'p_deleted', '{}', 1, 'm', %s)",
                (photos_event, VEC),
            )
            t0 = "2026-10-08 12:00:00"
            _load_replay_audit(conn, [
                (1, "event.facesearch.disable", disabled, disabled, t0),
                # same timestamp: the higher AuditLog id is the later action, so enable wins
                (2, "event.facesearch.disable", toggled_back, toggled_back, t0),
                (3, "event.facesearch.enable", toggled_back, toggled_back, t0),
                (4, "faceindex.purge", purged, purged, t0),
                (5, "faceindex.purge.request", requested, requested, t0),
                (6, "faceindex.purge", purged, purged, t0),
                (7, "photo.delete", photos_event, "p_deleted", t0),
            ])
            # indexing work in flight at T for a purged event, QUEUED *and* RUNNING (the worker is
            # stopped, so a RUNNING row would come back via requeue_stale and re-create Face rows)
            for key, type_, status, payload in (
                ("cluster-q", "CLUSTER_FACES", "QUEUED", f'{{"eventId": "{purged}"}}'),
                ("cluster-r", "CLUSTER_FACES", "RUNNING", f'{{"eventId": "{purged}"}}'),
                ("faces-q", "INDEX_FACES", "QUEUED", '{"photoId": "p_purged"}'),
                ("faces-r", "INDEX_FACES", "RUNNING", f'{{"photoId": "p_purged", "eventId": "{purged}"}}'),
                ("faces-other", "INDEX_FACES", "QUEUED", '{"photoId": "p_deleted"}'),
            ):
                conn.execute(
                    'INSERT INTO "Job"(type, payload, status, "dedupeKey") VALUES (%s, %s::jsonb, %s::"JobStatus", %s)',
                    (type_, payload, status, key),
                )

            conn.execute(REPLAY_SQL.read_text())

            enabled = dict(conn.execute('SELECT id, "faceSearchEnabled" FROM "Event" WHERE id = ANY(%s)', (ev,)).fetchall())
            assert enabled[disabled] is False  # disabled after T: stays disabled
            assert enabled[toggled_back] is True  # last toggle after T wins, ties broken by id
            assert enabled[purged] is True and enabled[requested] is True  # untouched by the toggle replay
            purges = _jobs(conn, "PURGE_FACE_INDEX", "eventId", ev)
            assert set(purges) == {purged, requested}  # once each, even with two audit rows for `purged`
            assert all(v[0] == "QUEUED" for v in purges.values())
            for key in ("cluster-q", "cluster-r", "faces-q", "faces-r"):
                assert _status(conn, key)[0] == "DEAD", key
            # the deleted photo is gone again, and its Face row with it (same cascade as the app's delete)
            assert conn.execute('SELECT count(*) FROM "Photo" WHERE id = %s', ("p_deleted",)).fetchone() == (0,)
            assert conn.execute('SELECT count(*) FROM "Face" WHERE id = %s', ("f_deleted",)).fetchone() == (0,)
            # its own indexing job can no longer find the photo; parking it is not the replay's business
            assert _status(conn, "faces-other")[0] == "QUEUED"
        finally:
            conn.rollback()


def test_replay_is_idempotent_across_the_queued_dead_and_running_branches() -> None:
    require_not_shared_hub()
    with psycopg.connect(SOURCE) as conn:
        try:
            a, b, c = [r[0] for r in conn.execute('SELECT id FROM "Event" ORDER BY id LIMIT 3').fetchall()]
            t0 = "2026-10-08 12:00:00"
            _load_replay_audit(conn, [
                (1, "faceindex.purge", a, a, t0),
                (2, "faceindex.purge.request", b, b, t0),
                (3, "faceindex.purge", c, c, t0),
            ])
            # pre-existing replay jobs: a finished one (DEAD) and one a worker still holds (RUNNING)
            conn.execute(
                'INSERT INTO "Job"(type, payload, status, attempts, "dedupeKey") VALUES'
                " ('PURGE_FACE_INDEX', %s::jsonb, 'DEAD'::\"JobStatus\", 5, %s),"
                " ('PURGE_FACE_INDEX', %s::jsonb, 'RUNNING'::\"JobStatus\", 1, %s)",
                (f'{{"eventId": "{a}"}}', f"purge-face:{a}:replay", f'{{"eventId": "{b}"}}', f"purge-face:{b}:replay"),
            )
            replay = REPLAY_SQL.read_text()
            conn.execute(replay)
            first = {k: _status(conn, f"purge-face:{k}:replay") for k in (a, b, c)}
            conn.execute(replay)  # an operator re-running the step must not change anything
            second = {k: _status(conn, f"purge-face:{k}:replay") for k in (a, b, c)}

            assert first == {a: ("QUEUED", 0), b: ("RUNNING", 1), c: ("QUEUED", 0)}
            assert second == first  # QUEUED rows keep attempts; RUNNING stays untouched; no duplicates
            n = conn.execute(
                "SELECT count(*) FROM \"Job\" WHERE type = 'PURGE_FACE_INDEX' AND \"dedupeKey\" LIKE '%%:replay'"
            ).fetchone()[0]
            assert n == 3
        finally:
            conn.rollback()


def test_export_selects_rows_after_t_in_utc_whatever_the_offset_or_session_time_zone(make_source) -> None:  # type: ignore[no-untyped-def]
    url = make_source(
        'CREATE TABLE "AuditLog" (id bigserial PRIMARY KEY, "studioId" text, "eventId" text, "actorUserId" text,'
        ' action text NOT NULL, target text, data jsonb, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
        # Prisma stores createdAt as UTC in a column without a time zone
        """INSERT INTO "AuditLog"(action, "eventId", target, "createdAt") VALUES
           ('faceindex.purge', 'e1', 'e1', '2026-10-08 11:59:59'),
           ('faceindex.purge', 'e2', 'e2', '2026-10-08 12:00:01'),
           ('guest.update',    'e2', 'g1', '2026-10-08 12:00:02'),
           ('photo.delete',    'e3', 'p9', '2026-10-08 12:00:03'),
           ('event.facesearch.disable', 'e3', 'e3', '2026-10-08 12:00:03')""",
    )
    parts = urlsplit(url)
    net, host = docker_net_and_host(parts.hostname or "localhost")

    def export(t: str) -> list[list[str]]:
        proc = subprocess.run(
            ["docker", "run", "--rm", "-i", *net, "-e", "PGPASSWORD", "-e", "PGOPTIONS", "pgvector/pgvector:pg16",
             "psql", "-h", host, "-p", str(parts.port or 5432), "-U", parts.username or "postgres",
             "-d", parts.path.lstrip("/"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", f"T={t}", "-f", "-"],
            input=EXPORT_SQL.read_text(), capture_output=True, text=True,
            # the runbook's read-only session, plus a non-UTC zone the export must not depend on
            env={**os.environ, "PGPASSWORD": parts.password or "",
                 "PGOPTIONS": "-c default_transaction_read_only=on -c TimeZone=America/Chicago"},
        )
        assert proc.returncode == 0, proc.stderr
        return list(csv.reader(io.StringIO(proc.stdout)))

    with_offset = export("2026-10-08T17:30:00+05:30")  # = 12:00:00 UTC
    as_utc = export("2026-10-08 12:00:00")              # no offset: read as UTC, not as the session zone

    assert with_offset == as_utc
    assert [(r[1], r[2], r[3]) for r in with_offset] == [
        ("faceindex.purge", "e2", "e2"),
        ("photo.delete", "e3", "p9"),
        ("event.facesearch.disable", "e3", "e3"),
    ]
    assert [int(r[0]) for r in with_offset] == sorted(int(r[0]) for r in with_offset), "ties are ordered by id"


def test_runbook_loads_the_replay_read_only_with_t_as_a_variable_and_reviews_before_commit() -> None:
    text = RUNBOOK.read_text()
    assert "replay-export.sql" in text and "replay-after-restore.sql" in text
    assert "default_transaction_read_only=on" in text
    assert '-v T="$T"' in text
    assert "'$T'" not in text, "T must reach SQL as a psql variable, not by shell interpolation"
    assert "FINISH=ROLLBACK" in text and "FINISH=COMMIT" in text
    assert 'createdAt" timestamp)' in text, "the temp table column matches AuditLog's type (no time zone)"
    assert "(cd packages/db &&" in text and "cd packages/db &&" not in text.replace("(cd packages/db &&", "")
    assert text.count("mkdir -p ./restore") >= 2  # Path B download, and before any export or verify dump
    assert "OLD_URL" in text and "LEG-008" in text
    assert "SELECT 'INDEX_FACES'" not in text, "no runbook step may re-queue face indexing"
    step5 = text[text.index("## 5."):text.index("## 6.")]
    assert "step 6" not in step5, "step 5 must not depend on work done later in step 6"
