"""PURGE_FACE_INDEX {eventId}

Delete all biometric data for an event (Face rows and their clusters), stamp
Event.faceIndexPurgedAt, clear Photo.facesIndexedAt, and audit it. PhotoMatch
rows are kept on purpose: they hold no biometric data.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping

import psycopg

from ..db import jsonb

log = logging.getLogger(__name__)


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    event_id = job["payload"]["eventId"]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute('SELECT id, "studioId" FROM "Event" WHERE id = %s FOR UPDATE', (event_id,))
            event = cur.fetchone()
            if event is None:
                log.warning("PURGE_FACE_INDEX: event %s no longer exists", event_id)
                return
            cur.execute('DELETE FROM "Face" WHERE "eventId" = %s', (event_id,))
            faces = cur.rowcount
            cur.execute('DELETE FROM "FaceCluster" WHERE "eventId" = %s', (event_id,))
            clusters = cur.rowcount
            cur.execute('UPDATE "Photo" SET "facesIndexedAt" = NULL WHERE "eventId" = %s AND "facesIndexedAt" IS NOT NULL', (event_id,))
            photos = cur.rowcount
            cur.execute('UPDATE "Event" SET "faceIndexPurgedAt" = now() WHERE id = %s', (event_id,))
            # a pending coalesced clustering run for this event is now pointless
            cur.execute(
                '''DELETE FROM "Job" WHERE "dedupeKey" = %s AND status = 'QUEUED'::"JobStatus"''',
                (f"cluster:{event_id}",),
            )
            cur.execute(
                '''INSERT INTO "AuditLog"("studioId", "eventId", action, target, data)
                   VALUES (%s, %s, 'faceindex.purge', %s, %s)''',
                (event["studioId"], event_id, event_id, jsonb({"faces": faces, "clusters": clusters, "photos": photos, "jobId": int(job["id"])})),
            )
    log.info("PURGE_FACE_INDEX %s: removed %d faces, %d clusters; reset %d photos", event_id, faces, clusters, photos)
