"""PROCESS_PHOTO handler against the real local Postgres with storage faked (skipped if Postgres is down).

ADM-022: the jobs dashboard's event view selects jobs by `payload->>'eventId'`, so the INDEX_FACES job
that PROCESS_PHOTO enqueues must carry the photo's eventId (and studioId), not just the photoId.
The suite must not share a database with a running consumer (see conftest.py): the INDEX_FACES row
this test creates is due immediately.
"""
from __future__ import annotations

import io

from PIL import Image

from hub_worker import storage
from hub_worker.handlers import process_photo


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 90, 60)).save(buf, "JPEG")
    return buf.getvalue()


def test_index_faces_job_carries_the_photos_event_and_studio(conn, tenant, monkeypatch):
    photo_id = tenant.add_photo()
    monkeypatch.setattr(storage, "get_bytes", lambda key: _jpeg())
    monkeypatch.setattr(storage, "put_bytes", lambda key, data, content_type="application/octet-stream": None)
    dedupe_key = f"faces:{photo_id}"
    try:
        process_photo.handle(conn, {"id": 1, "attempts": 1, "maxAttempts": 5, "payload": {"photoId": photo_id}})
        with conn.cursor() as cur:
            cur.execute('SELECT type, payload FROM "Job" WHERE "dedupeKey" = %s', (dedupe_key,))
            job = cur.fetchone()
        assert job is not None, "PROCESS_PHOTO must enqueue INDEX_FACES"
        assert job["type"] == "INDEX_FACES"
        assert job["payload"] == {"photoId": photo_id, "eventId": tenant.event_id, "studioId": tenant.studio_id}
    finally:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM "Job" WHERE "dedupeKey" = %s', (dedupe_key,))
