"""INDEX_FACES {photoId}

Detect + embed faces on the photo's `web` derivative, replace its Face rows,
stamp Photo.facesIndexedAt, then schedule CLUSTER_FACES for the event with a
20 s delay so a burst of uploads coalesces into one clustering run.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Mapping

import cv2
import numpy as np
import psycopg

from .. import face, storage
from ..config import MODEL_VERSION
from ..db import jsonb, new_id, vec_literal
from ..jobs import enqueue

log = logging.getLogger(__name__)

CLUSTER_DELAY_S = 20.0


def decode_bgr(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image")
    return img


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    photo_id = job["payload"]["photoId"]
    t0 = time.perf_counter()
    with conn.cursor() as cur:
        cur.execute(
            '''SELECT p.id, p."eventId", p.status, p.hidden, p.derivatives, p."originalKey",
                      e."faceSearchEnabled", e."faceIndexPurgedAt"
                 FROM "Photo" p JOIN "Event" e ON e.id = p."eventId"
                WHERE p.id = %s''',
            (photo_id,),
        )
        photo = cur.fetchone()
    if photo is None:
        log.warning("INDEX_FACES: photo %s no longer exists", photo_id)
        return
    if not photo["faceSearchEnabled"]:
        log.info("INDEX_FACES %s: face search disabled for event %s; skipping", photo_id, photo["eventId"])
        return
    if photo["status"] != "READY":
        raise RuntimeError(f"photo {photo_id} is {photo['status']}, not READY (will retry)")

    derivs = photo["derivatives"] or {}
    key = derivs.get("web") or photo["originalKey"]
    img = decode_bgr(storage.get_bytes(key))

    t_det = time.perf_counter()
    detected, analyzed = face.detect(img)
    t_emb = time.perf_counter()
    rows = []
    for f in detected:
        emb = face.embed(analyzed, f)
        rows.append((new_id(), photo["eventId"], photo_id, jsonb(f.bbox_norm), f.quality, MODEL_VERSION, vec_literal(emb)))
    t_done = time.perf_counter()

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute('DELETE FROM "Face" WHERE "photoId" = %s', (photo_id,))
            if rows:
                cur.executemany(
                    '''INSERT INTO "Face"(id, "eventId", "photoId", bbox, quality, "modelVersion", embedding)
                       VALUES (%s, %s, %s, %s, %s, %s, %s::vector)''',
                    rows,
                )
            cur.execute('UPDATE "Photo" SET "facesIndexedAt" = now() WHERE id = %s', (photo_id,))
        enqueue(
            conn, "CLUSTER_FACES", {"eventId": photo["eventId"]},
            dedupe_key=f"cluster:{photo['eventId']}", delay_s=CLUSTER_DELAY_S,
        )

    log.info(
        "INDEX_FACES %s: %d face(s) [detect %.0f ms, embed %.0f ms, total %.0f ms]",
        photo_id, len(rows), (t_emb - t_det) * 1000, (t_done - t_emb) * 1000, (time.perf_counter() - t0) * 1000,
    )
