"""BUILD_ZIP handler against the real local Postgres, with storage faked (no S3 needed)."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from hub_worker import storage
from hub_worker.db import new_id
from hub_worker.handlers import build_zip

PHOTO_BYTES = b"not really a jpeg"


def test_part_key_derives_from_zip_export_row_alone(conn, tenant, monkeypatch):
    """DB-001: the storage key uses ZipExport.studioId, not a join to Event.

    The row's studioId deliberately differs from the event's so a join would be caught.
    """
    row_studio = f"{tenant.studio_id}-row"
    tenant.add_photo()
    zip_id = new_id()
    with conn.cursor() as cur:
        cur.execute(
            '''INSERT INTO "ZipExport"(id, "studioId", "eventId", "scopeHash", "partKeys", status)
               VALUES (%s, %s, %s, 'h', '{}', 'QUEUED')''',
            (zip_id, row_studio, tenant.event_id),
        )

    uploaded: dict[str, list[str]] = {}

    def fake_put_file(key: str, path: Path | str, content_type: str = "") -> None:
        with zipfile.ZipFile(path) as zf:
            uploaded[key] = zf.namelist()

    monkeypatch.setattr(storage, "put_file", fake_put_file)
    monkeypatch.setattr(storage, "get_stream", lambda key: (io.BytesIO(PHOTO_BYTES), len(PHOTO_BYTES)))

    build_zip.handle(conn, {"payload": {"zipExportId": zip_id}})

    expected = storage.keys.zip(row_studio, tenant.event_id, zip_id, 1)
    assert expected.startswith(f"s/{row_studio}/e/{tenant.event_id}/zip/")
    assert list(uploaded) == [expected]
    assert len(uploaded[expected]) == 1
    with conn.cursor() as cur:
        cur.execute('SELECT status, "partKeys" FROM "ZipExport" WHERE id = %s', (zip_id,))
        assert cur.fetchone() == {"status": "READY", "partKeys": [expected]}
