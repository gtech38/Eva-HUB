"""The `tenant` fixture's helper (tests/tenants.py) cleans up after itself, even after failures."""
from __future__ import annotations

import psycopg
import pytest

from tenants import Tenant, sweep_stale_tenants

A = [1.0] + [0.0] * 127


def _exists(conn, table: str, row_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(f'SELECT 1 FROM "{table}" WHERE id = %s', (row_id,))
        return cur.fetchone() is not None


def _populate(t: Tenant) -> dict[str, str]:
    photo = t.add_photo()
    user = t.add_user()
    with t.conn.cursor() as cur:
        cur.execute('INSERT INTO "FaceCluster"(id, "eventId", "updatedAt") VALUES (%s, %s, now())',
                    (f"{t.event_id}-c", t.event_id))
        cur.execute('''INSERT INTO "PhotoMatch"(id, "photoId", "userId", source, score)
                       VALUES (%s, %s, %s, 'SELFIE'::"MatchSource", 0.5)''', (f"{t.event_id}-m", photo, user))
        cur.execute('''INSERT INTO "ZipExport"(id, "studioId", "eventId", "scopeHash", "partKeys", status)
                       VALUES (%s, %s, %s, 'h', '{}', 'QUEUED')''', (f"{t.event_id}-z", t.studio_id, t.event_id))
    return {"Photo": photo, "Face": t.add_face(photo, A), "User": user, "FaceCluster": f"{t.event_id}-c",
            "PhotoMatch": f"{t.event_id}-m", "ZipExport": f"{t.event_id}-z",
            "Event": t.event_id, "Studio": t.studio_id}


def test_failed_create_leaves_no_studio(conn):
    first = Tenant(conn)
    first.create()
    try:
        clash = Tenant(conn)
        clash.event_id = first.event_id  # Event insert fails after the Studio insert
        with pytest.raises(psycopg.errors.UniqueViolation):
            clash.create()
        assert not _exists(conn, "Studio", clash.studio_id)
    finally:
        first.cleanup()


def test_cleanup_removes_children_and_tolerates_missing_rows(conn):
    t = Tenant(conn)
    t.create()
    rows = _populate(t)
    t.cleanup()
    t.cleanup()  # second run finds nothing and must not fail
    assert [table for table, row_id in rows.items() if _exists(conn, table, row_id)] == []


def test_sweep_removes_only_stale_test_tenants(conn):
    old, fresh = Tenant(conn), Tenant(conn)
    old.create()
    fresh.create()
    try:
        rows = _populate(old)
        with conn.cursor() as cur:
            for table, row_id in (("Studio", old.studio_id), ("Event", old.event_id), ("User", rows["User"])):
                cur.execute(f'''UPDATE "{table}" SET "createdAt" = now() - interval '2 hours' WHERE id = %s''', (row_id,))
        sweep_stale_tenants(conn)
        assert [table for table, row_id in rows.items() if _exists(conn, table, row_id)] == []
        assert _exists(conn, "Event", fresh.event_id) and _exists(conn, "Studio", fresh.studio_id)
    finally:
        old.cleanup()
        fresh.cleanup()
