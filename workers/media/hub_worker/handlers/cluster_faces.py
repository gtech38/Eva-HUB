"""CLUSTER_FACES {eventId}

1. Load the event's Face embeddings with quality >= FACE_MIN_QUALITY.
2. Average-linkage agglomerative clustering on cosine distance, cut at
   FACE_CLUSTER_DISTANCE (default 1 - FACE_MATCH_THRESHOLD = 0.637).
3. Reconcile FaceCluster rows: a new cluster re-uses the id of the old cluster
   most of its faces came from (keeps host labels and `suppressed`, i.e. the
   "remove me from face search" state, stable across re-runs); otherwise a new
   row is created, inheriting `suppressed` when the majority of its members
   came from suppressed clusters. Orphan clusters are deleted.
4. For every FaceProfile whose user is a (non-deleted) Guest of this event and
   whose consent is not revoked, upsert PhotoMatch(PROFILE_AUTO) rows.
5. AuditLog `faceindex.cluster` with counts.

If photos were indexed while this job ran, the handler asks to be re-queued in
20 s instead of relying on the dedupe-keyed enqueue (which is a no-op while
the job is RUNNING).

Threshold note. OpenCV's SFace verification threshold is cosine 0.363 for
"same person" on LFW. Cosine *distance* in sklearn/scipy is 1 - cos, so the
equivalent cut is 0.637. Average linkage is more forgiving than single-pair
verification because a cluster is admitted on its mean distance, so in
practice 0.637 slightly over-merges on large weddings with many similar-
looking relatives; tightening to ~0.55 trades recall for purity. Tune with
scripts/bench_faces.py and FACE_CLUSTER_DISTANCE.
"""
from __future__ import annotations

import logging
import time
from collections import Counter, defaultdict
from typing import Any, Mapping

import numpy as np
import psycopg

from ..config import settings
from ..db import jsonb, new_id, parse_vec, vec_literal
from ..jobs import Requeue

log = logging.getLogger(__name__)

REQUEUE_DELAY_S = 20.0


def cluster_embeddings(X: np.ndarray, distance_threshold: float) -> np.ndarray:
    """Return an int label per row (0..k-1). Rows must be L2-normalized.

    Uses scikit-learn's AgglomerativeClustering (cosine metric, average
    linkage). For n faces this needs an n x n distance matrix (15k faces ~ 1.8
    GB in float64), which is the practical ceiling per event; above that,
    switch to HDBSCAN or shard by sub-event.
    """
    n = len(X)
    if n == 0:
        return np.zeros(0, dtype=int)
    if n == 1:
        return np.zeros(1, dtype=int)
    from sklearn.cluster import AgglomerativeClustering

    model = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        linkage="average",
        distance_threshold=float(distance_threshold),
    )
    return model.fit_predict(X.astype(np.float64))


def _reconcile_clusters(
    members: dict[int, list[dict]],
    old_clusters: dict[str, dict],
) -> tuple[dict[int, str], list[tuple[str, str, bool]]]:
    """Map each new label -> FaceCluster id.

    Returns (label -> cluster_id, new rows to insert as (id, eventId-less, suppressed)).
    Larger clusters pick first so the biggest group keeps an old id.
    """
    label_to_id: dict[int, str] = {}
    new_rows: list[tuple[str, str, bool]] = []
    taken: set[str] = set()
    for label in sorted(members, key=lambda l: -len(members[l])):
        faces = members[label]
        old_ids = [f["clusterId"] for f in faces if f["clusterId"] in old_clusters]
        suppressed_votes = sum(1 for cid in old_ids if old_clusters[cid]["suppressed"])
        dominant = Counter(old_ids).most_common(1)[0][0] if old_ids else None
        if dominant is not None and dominant not in taken:
            taken.add(dominant)
            label_to_id[label] = dominant
            continue
        cid = new_id()
        suppressed = suppressed_votes * 2 > len(faces)  # strict majority of *all* members
        new_rows.append((cid, "new", suppressed))
        label_to_id[label] = cid
    return label_to_id, new_rows


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> Requeue | None:
    event_id = job["payload"]["eventId"]
    locked_at = job.get("lockedAt")
    t0 = time.perf_counter()

    with conn.cursor() as cur:
        cur.execute('SELECT id, "studioId", "faceSearchEnabled" FROM "Event" WHERE id = %s', (event_id,))
        event = cur.fetchone()
        if event is None:
            log.warning("CLUSTER_FACES: event %s no longer exists", event_id)
            return None
        cur.execute(
            'SELECT id, "photoId", "clusterId", quality, embedding::text AS emb FROM "Face" WHERE "eventId" = %s ORDER BY id',
            (event_id,),
        )
        faces = cur.fetchall()
        cur.execute('SELECT id, label, suppressed FROM "FaceCluster" WHERE "eventId" = %s', (event_id,))
        old_clusters = {r["id"]: r for r in cur.fetchall()}

    eligible = [f for f in faces if f["quality"] is not None and f["quality"] >= settings.face_min_quality]
    labels = np.full(len(eligible), -1, dtype=int)
    if len(eligible) >= 2:
        X = np.stack([parse_vec(f["emb"]) for f in eligible]).astype(np.float32)
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        X = X / np.where(norms == 0, 1, norms)
        labels = cluster_embeddings(X, settings.face_cluster_distance)

    members: dict[int, list[dict]] = defaultdict(list)
    for f, lab in zip(eligible, labels):
        if lab >= 0:
            members[int(lab)].append(f)
    label_to_id, new_rows = _reconcile_clusters(members, old_clusters)

    assigned: dict[str, str] = {}
    for lab, fs in members.items():
        for f in fs:
            assigned[f["id"]] = label_to_id[lab]
    # every face gets written: clustered -> its cluster id, low-quality/unclustered -> NULL
    face_assignments: list[tuple[str | None, str]] = [(assigned.get(f["id"]), f["id"]) for f in faces]

    with conn.transaction():
        with conn.cursor() as cur:
            if new_rows:
                cur.executemany(
                    'INSERT INTO "FaceCluster"(id, "eventId", suppressed) VALUES (%s, %s, %s)',
                    [(cid, event_id, sup) for cid, _, sup in new_rows],
                )
            if face_assignments:
                cur.executemany('UPDATE "Face" SET "clusterId" = %s WHERE id = %s', face_assignments)
            cur.execute(
                '''DELETE FROM "FaceCluster" c
                    WHERE c."eventId" = %s
                      AND NOT EXISTS (SELECT 1 FROM "Face" f WHERE f."clusterId" = c.id)''',
                (event_id,),
            )
            deleted_clusters = cur.rowcount
            cur.execute('SELECT count(*) AS n FROM "FaceCluster" WHERE "eventId" = %s AND suppressed', (event_id,))
            suppressed_count = cur.fetchone()["n"]

    profiles_matched, matches_written = _match_profiles(conn, event_id)

    with conn.cursor() as cur:
        cur.execute(
            '''INSERT INTO "AuditLog"("studioId", "eventId", action, target, data)
               VALUES (%s, %s, 'faceindex.cluster', %s, %s)''',
            (
                event["studioId"], event_id, event_id,
                jsonb({
                    "faces": len(faces),
                    "eligible": len(eligible),
                    "clusters": len(members),
                    "newClusters": len(new_rows),
                    "deletedClusters": deleted_clusters,
                    "suppressedClusters": suppressed_count,
                    "profilesMatched": profiles_matched,
                    "photoMatches": matches_written,
                    "distanceThreshold": settings.face_cluster_distance,
                    "durationMs": round((time.perf_counter() - t0) * 1000),
                }),
            ),
        )

    log.info(
        "CLUSTER_FACES %s: %d faces (%d eligible) -> %d clusters (%d new, %d deleted); %d profile(s), %d matches; %.0f ms",
        event_id, len(faces), len(eligible), len(members), len(new_rows), deleted_clusters,
        profiles_matched, matches_written, (time.perf_counter() - t0) * 1000,
    )

    # Late arrivals: INDEX_FACES jobs that finished while we were running could not
    # re-enqueue us (dedupe key is held by this RUNNING row), so check ourselves.
    if locked_at is not None:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT 1 FROM "Photo" WHERE "eventId" = %s AND "facesIndexedAt" > %s LIMIT 1',
                (event_id, locked_at),
            )
            if cur.fetchone():
                return Requeue(REQUEUE_DELAY_S, "faces indexed during clustering")
    return None


def _match_profiles(conn: psycopg.Connection, event_id: str) -> tuple[int, int]:
    """Upsert PhotoMatch(PROFILE_AUTO) for every eligible FaceProfile in this event."""
    thr = settings.face_match_threshold
    with conn.cursor() as cur:
        cur.execute(
            '''SELECT fp.id, fp."userId", fp.embedding::text AS emb
                 FROM "FaceProfile" fp
                 JOIN "BiometricConsent" bc ON bc.id = fp."consentId" AND bc."revokedAt" IS NULL
                 JOIN "Guest" g ON g."userId" = fp."userId" AND g."eventId" = %s AND g."deletedAt" IS NULL
                WHERE fp.stale = false''',
            (event_id,),
        )
        profiles = cur.fetchall()
    if not profiles:
        return 0, 0

    written = 0
    for prof in profiles:
        q = vec_literal(parse_vec(prof["emb"]))
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    '''SELECT f."photoId", MAX(1 - (f.embedding <=> %s::vector)) AS score
                         FROM "Face" f
                         JOIN "Photo" p ON p.id = f."photoId"
                         LEFT JOIN "Album" a ON a.id = p."albumId"
                         LEFT JOIN "FaceCluster" c ON c.id = f."clusterId"
                        WHERE f."eventId" = %s
                          AND p.status = 'READY'::"PhotoStatus" AND NOT p.hidden
                          AND COALESCE(a.visibility <> 'HIDDEN'::"AlbumVisibility", true)
                          AND COALESCE(c.suppressed, false) = false
                        GROUP BY f."photoId"
                       HAVING MAX(1 - (f.embedding <=> %s::vector)) >= %s''',
                    (q, event_id, q, thr),
                )
                hits = cur.fetchall()
                photo_ids = [h["photoId"] for h in hits]
                if hits:
                    cur.executemany(
                        '''INSERT INTO "PhotoMatch"(id, "photoId", "userId", source, score, "matchedAt")
                           VALUES (%s, %s, %s, 'PROFILE_AUTO'::"MatchSource", %s, now())
                           ON CONFLICT ("userId", "photoId") DO UPDATE
                               SET score = GREATEST("PhotoMatch".score, EXCLUDED.score),
                                   "matchedAt" = now()''',
                        [(new_id(), h["photoId"], prof["userId"], float(h["score"])) for h in hits],
                    )
                # drop auto matches in this event that no longer hold (re-index / hidden / purged)
                cur.execute(
                    '''DELETE FROM "PhotoMatch" pm USING "Photo" p
                        WHERE pm."photoId" = p.id AND p."eventId" = %s
                          AND pm."userId" = %s AND pm.source = 'PROFILE_AUTO'::"MatchSource"
                          AND NOT (pm."photoId" = ANY(%s))''',
                    (event_id, prof["userId"], photo_ids),
                )
                written += len(hits)
    return len(profiles), written
