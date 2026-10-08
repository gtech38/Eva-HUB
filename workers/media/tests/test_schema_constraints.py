"""Database-level invariants the worker relies on (DB-001), checked against the real local Postgres.

Prisma cannot express these, so they live as raw SQL in
packages/db/prisma/migrations/*_add_tenant_columns_and_checks/migration.sql.
Every violating insert runs in a transaction that is rolled back, so nothing is left behind.
"""
from __future__ import annotations

import psycopg
import pytest

from hub_worker.db import new_id

INSERT_MATCH = '''INSERT INTO "PhotoMatch"(id, "photoId", "userId", "subjectGuestId", source, score)
                  VALUES (%s, %s, %s, %s, 'SELFIE'::"MatchSource", 0.5)'''


def _insert_match(conn: psycopg.Connection, photo_id: str, user_id: str | None, guest_id: str | None) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(INSERT_MATCH, (new_id(), photo_id, user_id, guest_id))


def test_photomatch_rejects_neither_user_nor_subject_guest(conn, tenant):
    photo_id = tenant.add_photo()
    with pytest.raises(psycopg.errors.CheckViolation, match="PhotoMatch_one_subject"):
        _insert_match(conn, photo_id, None, None)


def test_photomatch_rejects_both_user_and_subject_guest(conn, tenant):
    photo_id = tenant.add_photo()
    user_id = tenant.add_user()
    with pytest.raises(psycopg.errors.CheckViolation, match="PhotoMatch_one_subject"):
        _insert_match(conn, photo_id, user_id, "some-guest-id")


def test_photomatch_accepts_exactly_one_subject(conn, tenant):
    photo_id = tenant.add_photo()
    user_id = tenant.add_user()
    _insert_match(conn, photo_id, user_id, None)
    _insert_match(conn, photo_id, None, "some-guest-id")
    with conn.cursor() as cur:
        cur.execute('SELECT count(*) AS n FROM "PhotoMatch" WHERE "photoId" = %s', (photo_id,))
        assert cur.fetchone()["n"] == 2


def test_deleting_user_removes_their_matches(conn, tenant):
    """The FK must cascade: SET NULL would leave a subject-less row the CHECK rejects."""
    photo_id = tenant.add_photo()
    user_id = tenant.add_user()
    _insert_match(conn, photo_id, user_id, None)
    _insert_match(conn, photo_id, None, "some-guest-id")

    with conn.cursor() as cur:
        cur.execute('DELETE FROM "User" WHERE id = %s', (user_id,))
        cur.execute('SELECT "userId", "subjectGuestId" FROM "PhotoMatch" WHERE "photoId" = %s', (photo_id,))
        assert cur.fetchall() == [{"userId": None, "subjectGuestId": "some-guest-id"}]


def test_zipexport_requires_studio_id(conn, tenant):
    with pytest.raises(psycopg.errors.NotNullViolation, match="studioId"):
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO "ZipExport"(id, "studioId", "eventId", "scopeHash", "partKeys", status)
                   VALUES (%s, NULL, %s, 'h', '{}', 'QUEUED')''',
                (new_id(), tenant.event_id),
            )
