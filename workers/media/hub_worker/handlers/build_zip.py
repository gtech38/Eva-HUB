"""BUILD_ZIP {zipExportId}

Stream the originals of an event's downloadable photos (READY, not hidden,
album visibility GUESTS or no album) into zip64 archives, split into parts of
at most ZIP_PART_BYTES (2 GB default), each built in a temp file and uploaded
to  s/{studioId}/e/{eventId}/zip/{zipId}-{n}.zip . ZipExport.partKeys/status/
bytes are updated as parts complete so a crash mid-way leaves a usable trail.
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Mapping

import psycopg

from .. import storage
from ..config import settings

log = logging.getLogger(__name__)

ZIP_OVERHEAD_PER_FILE = 1024  # local+central header, zip64 extras, name; generous
CHUNK = 8 * 1024 * 1024

_unsafe = re.compile(r"[^A-Za-z0-9._ -]+")


def safe_name(filename: str, fallback: str) -> str:
    name = _unsafe.sub("_", (filename or "").strip().replace("/", "_").replace("\\", "_")).strip(" .")
    return name or fallback


def unique_names(photos: list[dict]) -> list[str]:
    """Stable, collision-free archive names; duplicates get the photo id appended."""
    seen: dict[str, int] = {}
    names = []
    for p in photos:
        ext = Path(p["originalKey"]).suffix or ".jpg"
        base = safe_name(p["filename"], f"{p['id']}{ext}")
        if Path(base).suffix == "":
            base += ext
        if base in seen:
            stem, suf = os.path.splitext(base)
            base = f"{stem}-{p['id'][-6:]}{suf}"
        seen[base] = 1
        names.append(base)
    return names


def _set_status(conn: psycopg.Connection, zip_id: str, status: str, part_keys: list[str] | None = None, total_bytes: int | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            '''UPDATE "ZipExport"
                  SET status = %s,
                      "partKeys" = COALESCE(%s, "partKeys"),
                      bytes = COALESCE(%s, bytes)
                WHERE id = %s''',
            (status, part_keys, total_bytes, zip_id),
        )


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    zip_id = job["payload"]["zipExportId"]
    t0 = time.perf_counter()
    with conn.cursor() as cur:
        # the row alone determines the storage key s/{studioId}/e/{eventId}/zip/...
        cur.execute(
            'SELECT id, "studioId", "eventId", status FROM "ZipExport" WHERE id = %s',
            (zip_id,),
        )
        zx = cur.fetchone()
        if zx is None:
            log.warning("BUILD_ZIP: ZipExport %s no longer exists", zip_id)
            return
        cur.execute(
            '''SELECT p.id, p.filename, p."originalKey", p."originalBytes", p."sortKey", p."createdAt"
                 FROM "Photo" p LEFT JOIN "Album" a ON a.id = p."albumId"
                WHERE p."eventId" = %s
                  AND p.status = 'READY'::"PhotoStatus" AND NOT p.hidden
                  AND (p."albumId" IS NULL OR a.visibility = 'GUESTS'::"AlbumVisibility")
                ORDER BY p."sortKey" NULLS LAST, p."createdAt", p.id''',
            (zx["eventId"],),
        )
        photos = cur.fetchall()

    _set_status(conn, zip_id, "BUILDING", part_keys=[])
    limit = settings.zip_part_bytes
    part_keys: list[str] = []
    total_bytes = 0
    names = unique_names(photos)

    tmpdir = tempfile.mkdtemp(prefix="hubzip-")
    try:
        part_no = 1
        part_path: Path | None = None
        zf: zipfile.ZipFile | None = None
        part_size = 0

        def open_part() -> None:
            nonlocal part_path, zf, part_size
            part_path = Path(tmpdir) / f"{zip_id}-{part_no}.zip"
            zf = zipfile.ZipFile(part_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True)
            part_size = 0

        def close_and_upload() -> None:
            nonlocal part_no, zf, part_path, total_bytes
            assert zf is not None and part_path is not None
            zf.close()
            key = storage.keys.zip(zx["studioId"], zx["eventId"], zip_id, part_no)
            storage.put_file(key, part_path, "application/zip")
            size = part_path.stat().st_size
            total_bytes += size
            part_keys.append(key)
            part_path.unlink(missing_ok=True)
            _set_status(conn, zip_id, "BUILDING", part_keys=list(part_keys), total_bytes=total_bytes)
            log.info("BUILD_ZIP %s: part %d uploaded (%.1f MB)", zip_id, part_no, size / 1e6)
            part_no += 1
            zf = None

        open_part()
        for photo, arcname in zip(photos, names):
            size = int(photo["originalBytes"] or 0)
            if part_size > 0 and part_size + size + ZIP_OVERHEAD_PER_FILE > limit:
                close_and_upload()
                open_part()
            body, length = storage.get_stream(photo["originalKey"])
            info = zipfile.ZipInfo(arcname, date_time=(photo["createdAt"] or time.gmtime()).timetuple()[:6])
            info.compress_type = zipfile.ZIP_STORED
            info.file_size = length
            assert zf is not None
            with zf.open(info, "w", force_zip64=True) as dst:
                while True:
                    chunk = body.read(CHUNK)
                    if not chunk:
                        break
                    dst.write(chunk)
            part_size += length + ZIP_OVERHEAD_PER_FILE
        close_and_upload()
        _set_status(conn, zip_id, "READY", part_keys=part_keys, total_bytes=total_bytes)
    except Exception:
        _set_status(conn, zip_id, "FAILED")
        raise
    finally:
        for leftover in Path(tmpdir).glob("*"):
            leftover.unlink(missing_ok=True)
        os.rmdir(tmpdir)

    log.info(
        "BUILD_ZIP %s: %d photos, %d part(s), %.1f MB in %.1f s",
        zip_id, len(photos), len(part_keys), total_bytes / 1e6, time.perf_counter() - t0,
    )
