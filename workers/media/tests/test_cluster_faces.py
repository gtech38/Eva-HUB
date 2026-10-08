"""CLUSTER_FACES handler against the real local Postgres (skipped if unreachable).

The consumer-path test lives in tests/test_jobs.py; these call the handler directly.
Clusters are backdated between runs so "unchanged" and "bumped" timestamps are distinguishable
at timestamp(3) resolution.
"""
from __future__ import annotations

from hub_worker.handlers import cluster_faces

A = [1.0] + [0.0] * 127
B = [0.99, 0.1] + [0.0] * 126  # cosine ~0.995 to A: same cluster
C = [0.98, 0.0, 0.15] + [0.0] * 125  # also close to A


def _clusters(conn, event_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, "createdAt", "updatedAt" FROM "FaceCluster" WHERE "eventId" = %s ORDER BY id',
            (event_id,),
        )
        return cur.fetchall()


def _backdate(conn, event_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            '''UPDATE "FaceCluster" SET "createdAt" = "createdAt" - interval '1 hour',
                                        "updatedAt" = "updatedAt" - interval '1 hour'
                WHERE "eventId" = %s''',
            (event_id,),
        )
    return _clusters(conn, event_id)


def _run(conn, event_id: str) -> None:
    assert cluster_faces.handle(conn, {"payload": {"eventId": event_id}}) is None


def test_unchanged_rerun_keeps_cluster_row(conn, tenant):
    for emb in (A, B):
        tenant.add_face(tenant.add_photo(), emb)
    _run(conn, tenant.event_id)
    first = _clusters(conn, tenant.event_id)
    assert len(first) == 1
    assert first[0]["createdAt"] is not None and first[0]["updatedAt"] is not None

    before = _backdate(conn, tenant.event_id)
    _run(conn, tenant.event_id)
    assert _clusters(conn, tenant.event_id) == before


def test_reused_cluster_bumps_updated_at_when_members_change(conn, tenant):
    for emb in (A, B):
        tenant.add_face(tenant.add_photo(), emb)
    _run(conn, tenant.event_id)
    [before] = _backdate(conn, tenant.event_id)

    tenant.add_face(tenant.add_photo(), C)
    _run(conn, tenant.event_id)

    [after] = _clusters(conn, tenant.event_id)
    assert after["id"] == before["id"]
    assert after["createdAt"] == before["createdAt"]
    assert after["updatedAt"] > before["updatedAt"]
