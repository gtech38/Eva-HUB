"""PURGE_FACE_INDEX handler against the real local Postgres, checked by the LEG-005 verifier.

The handler is the control the biometric compliance checklist points at (docs/compliance/biometrics.md),
and scripts/compliance/verify-purge.mjs is how an operator proves it ran. These tests run the real
handler on a throwaway event and then run the real script, so a change to either one that breaks the
runbook fails here instead of in an audit.

The script refuses the shared `hub` database by design, so the end-to-end tests skip when
DATABASE_URL points at it; run them against a dedicated database (e.g. hub_t<N>).
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest

from hub_worker.config import settings
from hub_worker.handlers import purge_face_index

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "compliance" / "verify-purge.mjs"
# The database the `conn` fixture uses (hub_worker.config loads .env), which is also the one the script is told to check.
DB_NAME = urlparse(settings.database_url).path.lstrip("/")

A = [1.0] + [0.0] * 127
B = [0.99, 0.1] + [0.0] * 126


def _count(conn, sql: str, *params) -> int:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()["n"]


def _seed_indexed_event(conn, tenant) -> str:
    """Two indexed photos, two faces, a cluster, a saved match; returns the matched photo id."""
    user_id = tenant.add_user()
    p1, p2 = tenant.add_photo(), tenant.add_photo()
    tenant.add_face(p1, A)
    tenant.add_face(p2, B)
    with conn.cursor() as cur:
        cur.execute('UPDATE "Photo" SET "facesIndexedAt" = now() WHERE "eventId" = %s', (tenant.event_id,))
        cur.execute(
            'INSERT INTO "FaceCluster"(id, "eventId", "updatedAt") VALUES (%s, %s, now())',
            (f"{tenant.event_id}-c", tenant.event_id),
        )
        cur.execute('UPDATE "Face" SET "clusterId" = %s WHERE "eventId" = %s', (f"{tenant.event_id}-c", tenant.event_id))
        cur.execute(
            '''INSERT INTO "PhotoMatch"(id, "photoId", "userId", source, score)
               VALUES (%s, %s, %s, 'SELFIE'::"MatchSource", 0.9)''',
            (f"{tenant.event_id}-m", p1, user_id),
        )
    return p1


def _purge(conn, tenant) -> None:
    assert purge_face_index.handle(conn, {"id": 1, "payload": {"eventId": tenant.event_id}}) is None


def test_purge_deletes_biometric_rows_keeps_matches_and_audits_counts(conn, tenant):
    _seed_indexed_event(conn, tenant)
    _purge(conn, tenant)

    assert _count(conn, 'SELECT count(*)::int AS n FROM "Face" WHERE "eventId" = %s', tenant.event_id) == 0
    assert _count(conn, 'SELECT count(*)::int AS n FROM "FaceCluster" WHERE "eventId" = %s', tenant.event_id) == 0
    assert _count(conn, 'SELECT count(*)::int AS n FROM "Photo" WHERE "eventId" = %s AND "facesIndexedAt" IS NOT NULL', tenant.event_id) == 0
    # PhotoMatch holds no biometric data and survives on purpose (docs/01 §6); the checklist says so.
    assert _count(conn, 'SELECT count(*)::int AS n FROM "PhotoMatch" WHERE id = %s', f"{tenant.event_id}-m") == 1
    with conn.cursor() as cur:
        cur.execute('SELECT "faceIndexPurgedAt" FROM "Event" WHERE id = %s', (tenant.event_id,))
        assert cur.fetchone()["faceIndexPurgedAt"] is not None
        cur.execute(
            '''SELECT data, "actorUserId" FROM "AuditLog" WHERE "eventId" = %s AND action = 'faceindex.purge' ''',
            (tenant.event_id,),
        )
        [audit] = cur.fetchall()
    assert audit["data"] == {"faces": 2, "clusters": 1, "photos": 2, "jobId": 1}
    # The worker row has no actor; who asked is in the admin's 'faceindex.purge.request' row (runbook step 2).
    assert audit["actorUserId"] is None


def test_purge_is_repeatable_and_ignores_unknown_events(conn, tenant):
    _seed_indexed_event(conn, tenant)
    _purge(conn, tenant)
    _purge(conn, tenant)
    assert _count(conn, '''SELECT count(*)::int AS n FROM "AuditLog" WHERE "eventId" = %s AND action = 'faceindex.purge' ''', tenant.event_id) == 2
    assert purge_face_index.handle(conn, {"id": 2, "payload": {"eventId": "test-event-does-not-exist"}}) is None


needs_cli = pytest.mark.skipif(
    shutil.which("node") is None or not DB_NAME or DB_NAME.lower() == "hub",
    reason=f"needs node and a dedicated database; DATABASE_URL points at '{DB_NAME}' (verify-purge refuses 'hub')",
)


def _verify(event_id: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(SCRIPT), event_id, "--database", DB_NAME],
        capture_output=True, text=True, cwd=REPO, env={**os.environ, "DATABASE_URL": settings.database_url}, timeout=60,
    )


@needs_cli
def test_verify_purge_fails_before_and_passes_after_the_real_handler(conn, tenant):
    _seed_indexed_event(conn, tenant)
    before = _verify(tenant.event_id)
    assert before.returncode == 1, before.stdout + before.stderr
    assert "FAIL" in before.stdout

    _purge(conn, tenant)
    after = _verify(tenant.event_id)
    assert after.returncode == 0, after.stdout + after.stderr
    assert "RESULT: PASS" in after.stdout
