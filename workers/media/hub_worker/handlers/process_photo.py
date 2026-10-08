"""PROCESS_PHOTO {photoId}

Download the original, orient it, read the EXIF capture time, write thumb /
web / watermarked-web derivatives to the bucket, update the Photo row, and
enqueue INDEX_FACES for it. On any failure the Photo is marked FAILED (the job
itself is retried by the consumer).
"""
from __future__ import annotations

import logging
import time
from typing import Any, Mapping

import psycopg

from .. import storage
from ..db import jsonb, utcnow
from ..imaging import captured_at, make_variants, open_oriented
from ..jobs import enqueue

log = logging.getLogger(__name__)


def _credit(brand: Mapping[str, Any] | None) -> str:
    if isinstance(brand, Mapping):
        for key in ("watermark", "credit", "name"):
            v = brand.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return "PROOF"


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    photo_id = job["payload"]["photoId"]
    t0 = time.perf_counter()
    with conn.cursor() as cur:
        cur.execute(
            '''SELECT p.id, p."studioId", p."eventId", p."originalKey", p."createdAt", p.status,
                      s."brandJson"
                 FROM "Photo" p JOIN "Studio" s ON s.id = p."studioId"
                WHERE p.id = %s''',
            (photo_id,),
        )
        photo = cur.fetchone()
    if photo is None:
        log.warning("PROCESS_PHOTO: photo %s no longer exists; nothing to do", photo_id)
        return

    with conn.cursor() as cur:
        cur.execute('UPDATE "Photo" SET status = \'PROCESSING\'::"PhotoStatus" WHERE id = %s', (photo_id,))

    try:
        data = storage.get_bytes(photo["originalKey"])
        img = open_oriented(data)
        width, height = img.size
        shot_at = captured_at(img)
        variants = make_variants(img, _credit(photo["brandJson"]))

        derivatives: dict[str, str] = {}
        for variant, payload in variants.items():
            key = storage.keys.derivative(photo["studioId"], photo["eventId"], photo_id, variant)
            storage.put_bytes(key, payload, "image/jpeg")
            derivatives[variant] = key

        sort_dt = shot_at or photo["createdAt"]
        sort_key = sort_dt.replace(tzinfo=None).isoformat(timespec="milliseconds")

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    '''UPDATE "Photo"
                          SET width = %s, height = %s, "capturedAt" = %s, derivatives = %s,
                              "sortKey" = %s, status = 'READY'::"PhotoStatus"
                        WHERE id = %s''',
                    (width, height, shot_at, jsonb(derivatives), sort_key, photo_id),
                )
            enqueue(conn, "INDEX_FACES", {"photoId": photo_id}, dedupe_key=f"faces:{photo_id}")
    except Exception:
        with conn.cursor() as cur:
            cur.execute('UPDATE "Photo" SET status = \'FAILED\'::"PhotoStatus" WHERE id = %s', (photo_id,))
        raise

    log.info(
        "PROCESS_PHOTO %s: %dx%d captured=%s -> %s in %.0f ms",
        photo_id, width, height, shot_at.isoformat() if shot_at else None,
        ",".join(sorted(derivatives)), (time.perf_counter() - t0) * 1000,
    )
