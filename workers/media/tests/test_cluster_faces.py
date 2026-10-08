"""CLUSTER_FACES handler against the real local Postgres (skipped if unreachable).

The consumer-path test lives in tests/test_jobs.py; this one calls the handler directly.
"""
from __future__ import annotations

from hub_worker.handlers import cluster_faces

A = [1.0] + [0.0] * 127
B = [0.99, 0.1] + [0.0] * 126  # cosine ~0.995 to A: same cluster


def _clusters(conn, event_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, "createdAt", "updatedAt" FROM "FaceCluster" WHERE "eventId" = %s ORDER BY id',
            (event_id,),
        )
        return cur.fetchall()


def test_rerun_keeps_cluster_id_and_created_at(conn, tenant):
    for emb in (A, B):
        tenant.add_face(tenant.add_photo(), emb)
    job = {"payload": {"eventId": tenant.event_id}}

    assert cluster_faces.handle(conn, job) is None
    first = _clusters(conn, tenant.event_id)
    assert len(first) == 1
    assert first[0]["createdAt"] is not None and first[0]["updatedAt"] is not None

    assert cluster_faces.handle(conn, job) is None
    assert _clusters(conn, tenant.event_id) == first
