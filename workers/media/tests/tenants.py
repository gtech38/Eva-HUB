"""Throwaway tenants for Postgres-backed worker tests (used by the `tenant` fixture in conftest.py).

Ids carry fixed prefixes (`test-studio-`, `test-event-`, `test-user-`) so rows left by a killed run
can be found and swept. Photos, faces and the other rows a test hangs off the event get generated
ids; they are found through the event.
"""
from __future__ import annotations

import uuid
from typing import Any, Sequence

import psycopg
from psycopg.types.json import Jsonb

from hub_worker.db import new_id, vec_literal


class Tenant:
    """A throwaway Studio + Event.

    `cleanup()` deletes them, the users made by `add_user()`, and the event's
    PhotoMatch/Face/FaceCluster/Photo/ZipExport/AuditLog rows (see `delete_tenant_rows`).
    Rows a test creates in any other table are its own responsibility.
    """

    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn
        tag = uuid.uuid4().hex[:10]
        self.studio_id = f"test-studio-{tag}"
        self.event_id = f"test-event-{tag}"
        self.user_ids: list[str] = []

    def create(self) -> None:
        """Insert the Studio and Event atomically, so a failed Event insert leaves no Studio."""
        with self.conn.transaction(), self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Studio"(id, slug, name) VALUES (%s, %s, %s)',
                (self.studio_id, self.studio_id, "pytest studio"),
            )
            cur.execute(
                '''INSERT INTO "Event"(id, "studioId", slug, title, theme, "updatedAt")
                   VALUES (%s, %s, %s, %s, 'LUXURY'::"ThemeKey", now())''',
                (self.event_id, self.studio_id, self.event_id, Jsonb({"en": "pytest"})),
            )

    def add_user(self) -> str:
        user_id = f"test-user-{uuid.uuid4().hex[:10]}"
        with self.conn.cursor() as cur:
            cur.execute('INSERT INTO "User"(id, "updatedAt") VALUES (%s, now())', (user_id,))
        self.user_ids.append(user_id)
        return user_id

    def add_photo(
        self,
        studio_id: str | None = None,
        *,
        photo_id: str | None = None,
        filename: str | None = None,
        sort_key: str | None = None,
        created_at: Any = None,
    ) -> str:
        """A READY photo in this event; `studio_id` overrides the studio (for mismatch tests)."""
        photo_id = photo_id or new_id()
        with self.conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO "Photo"(id, "studioId", "eventId", "originalKey", "originalBytes",
                                       checksum, filename, status, "sortKey", "createdAt")
                   VALUES (%s, %s, %s, %s, 0, %s, %s, 'READY'::"PhotoStatus", %s, COALESCE(%s, now()))''',
                (photo_id, studio_id or self.studio_id, self.event_id, f"orig/{photo_id}.jpg", photo_id,
                 filename or f"{photo_id}.jpg", sort_key, created_at),
            )
        return photo_id

    def add_face(self, photo_id: str, embedding: list[float], quality: float = 0.9) -> str:
        face_id = new_id()
        with self.conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO "Face"(id, "eventId", "photoId", bbox, quality, "modelVersion", embedding)
                   VALUES (%s, %s, %s, %s, %s, 'pytest', %s::vector)''',
                (face_id, self.event_id, photo_id, Jsonb({"x": 0, "y": 0, "w": 1, "h": 1}), quality,
                 vec_literal(embedding)),
            )
        return face_id

    def cleanup(self) -> None:
        """Idempotent: rows that were never created (or are already gone) are simply not found."""
        delete_tenant_rows(self.conn, [self.event_id], [self.studio_id], self.user_ids)


def delete_tenant_rows(
    conn: psycopg.Connection, event_ids: Sequence[str], studio_ids: Sequence[str], user_ids: Sequence[str]
) -> None:
    """Delete test events/studios/users and their children, children first, in one transaction."""
    e, s, u = list(event_ids), list(studio_ids), list(user_ids)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            '''DELETE FROM "PhotoMatch" pm USING "Photo" p
                WHERE pm."photoId" = p.id AND p."eventId" = ANY(%s)''',
            (e,),
        )
        cur.execute('DELETE FROM "Face" WHERE "eventId" = ANY(%s)', (e,))
        cur.execute('DELETE FROM "FaceCluster" WHERE "eventId" = ANY(%s)', (e,))
        cur.execute('DELETE FROM "Photo" WHERE "eventId" = ANY(%s)', (e,))
        cur.execute('DELETE FROM "ZipExport" WHERE "eventId" = ANY(%s)', (e,))
        cur.execute('DELETE FROM "AuditLog" WHERE "eventId" = ANY(%s) OR "studioId" = ANY(%s)', (e, s))
        cur.execute('DELETE FROM "Event" WHERE id = ANY(%s)', (e,))
        cur.execute('DELETE FROM "Studio" WHERE id = ANY(%s)', (s,))
        cur.execute('DELETE FROM "User" WHERE id = ANY(%s)', (u,))  # cascades their PhotoMatch rows


def sweep_stale_tenants(conn: psycopg.Connection, older_than: str = "1 hour") -> None:
    """Recover from killed runs: remove prefixed test studios/events/users older than `older_than`
    (live runs are younger), including every event of a stale test studio."""
    with conn.cursor() as cur:
        cur.execute(
            '''SELECT id FROM "Studio"
                WHERE id LIKE 'test-studio-%%' AND "createdAt" < now() - %s::interval''',
            (older_than,),
        )
        studios = [r["id"] for r in cur.fetchall()]
        cur.execute(
            '''SELECT id FROM "Event"
                WHERE (id LIKE 'test-event-%%' AND "createdAt" < now() - %s::interval)
                   OR "studioId" = ANY(%s)''',
            (older_than, studios),
        )
        events = [r["id"] for r in cur.fetchall()]
        cur.execute(
            '''SELECT id FROM "User"
                WHERE id LIKE 'test-user-%%' AND "createdAt" < now() - %s::interval''',
            (older_than,),
        )
        users = [r["id"] for r in cur.fetchall()]
    delete_tenant_rows(conn, events, studios, users)
