"""BUILD_ZIP handler against the real local Postgres, with storage faked (no S3 needed)."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from hub_worker import storage
from hub_worker.db import new_id
from hub_worker.handlers import build_zip

PHOTO_BYTES = b"not really a jpeg"


@pytest.fixture
def uploads(monkeypatch) -> dict[str, list[str]]:
    """Fake storage: part key -> archive member names; every original reads as PHOTO_BYTES."""
    uploaded: dict[str, list[str]] = {}

    def fake_put_file(key: str, path: Path | str, content_type: str = "") -> None:
        with zipfile.ZipFile(path) as zf:
            uploaded[key] = zf.namelist()

    monkeypatch.setattr(storage, "put_file", fake_put_file)
    monkeypatch.setattr(storage, "get_stream", lambda key: (io.BytesIO(PHOTO_BYTES), len(PHOTO_BYTES)))
    return uploaded


def _zip_export(conn, studio_id: str, event_id: str) -> str:
    zip_id = new_id()
    with conn.cursor() as cur:
        cur.execute(
            '''INSERT INTO "ZipExport"(id, "studioId", "eventId", "scopeHash", "partKeys", status)
               VALUES (%s, %s, %s, 'h', '{}', 'QUEUED')''',
            (zip_id, studio_id, event_id),
        )
    return zip_id


def _status(conn, zip_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute('SELECT status, "partKeys" FROM "ZipExport" WHERE id = %s', (zip_id,))
        return cur.fetchone()


def test_part_key_derives_from_zip_export_row_alone(conn, tenant, uploads):
    """DB-001: the storage key uses ZipExport.studioId, not a join to Event.

    The row's studioId deliberately differs from the event's so a join would be caught.
    """
    row_studio = f"{tenant.studio_id}-row"
    tenant.add_photo(studio_id=row_studio)
    zip_id = _zip_export(conn, row_studio, tenant.event_id)

    build_zip.handle(conn, {"payload": {"zipExportId": zip_id}})

    expected = storage.keys.zip(row_studio, tenant.event_id, zip_id, 1)
    assert expected.startswith(f"s/{row_studio}/e/{tenant.event_id}/zip/")
    assert list(uploads) == [expected]
    assert len(uploads[expected]) == 1
    assert _status(conn, zip_id) == {"status": "READY", "partKeys": [expected]}


def test_photos_of_another_studio_are_not_zipped(conn, tenant, uploads):
    """The photo query is tenant-scoped by the row's studioId as well as its eventId."""
    tenant.add_photo(studio_id=f"{tenant.studio_id}-other")
    zip_id = _zip_export(conn, tenant.studio_id, tenant.event_id)

    build_zip.handle(conn, {"payload": {"zipExportId": zip_id}})

    expected = storage.keys.zip(tenant.studio_id, tenant.event_id, zip_id, 1)
    assert uploads == {expected: []}
    assert _status(conn, zip_id)["status"] == "READY"
