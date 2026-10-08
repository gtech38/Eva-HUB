# hub-media-worker

Python job consumer and face-embedding service for the Event & Photo Delivery Hub.
Everything runs locally against the docker-compose Postgres (pgvector) and the
S3-compatible bucket; there are no cloud calls.

What it does:

| Job type           | Payload              | Effect |
|--------------------|----------------------|--------|
| `PROCESS_PHOTO`    | `{photoId}`          | orient original, read EXIF capture time, write `thumb` (400 px, q80), `web` (2048 px, q85), `webWm` (web + tiled diagonal watermark from `Studio.brandJson.credit`, else "PROOF"); `Photo.status=READY`, `derivatives={thumb,web,webWm}`; enqueues `INDEX_FACES` |
| `INDEX_FACES`      | `{photoId, eventId, studioId}` (handler reads only `photoId`; the ids let per-event views scope the job) | YuNet detect + SFace embed on the `web` derivative; replaces `Face` rows; `Photo.facesIndexedAt`; enqueues `CLUSTER_FACES` (dedupe `cluster:{eventId}`, +20 s) |
| `CLUSTER_FACES`    | `{eventId}`          | agglomerative clustering -> `FaceCluster` (ids/labels/`suppressed` preserved), `Face.clusterId`; `PhotoMatch(PROFILE_AUTO)` for opted-in guests; `AuditLog faceindex.cluster` |
| `PURGE_FACE_INDEX` | `{eventId}`          | deletes `Face`/`FaceCluster`, sets `Event.faceIndexPurgedAt`, clears `Photo.facesIndexedAt`; `AuditLog faceindex.purge` |
| `BUILD_ZIP`        | `{zipExportId}`      | streams originals (READY, not hidden, album GUESTS/none) into zip64 parts <= 2 GB at `s/{studio}/e/{event}/zip/{zipId}-{n}.zip`; updates `ZipExport` |
| `FIRE_REMINDER`    | `{reminderRuleId}`   | stub: sets `ReminderRule.firedAt` |
| `SEND_MESSAGE`, `PRINT_SUBMIT` | any      | stubs: log and succeed |

HTTP (internal, `WORKER_PORT`, default 8010):

- `GET /health` -> `{"ok":true,"models_loaded":bool,"models_present":bool,"model":"yunet-2023mar+sface-2021dec"}`
- `POST /embed-selfie` multipart field `file` -> `{"ok":true,"embedding":[128 floats],"model":"...","faces":n,"quality":q}`
  or `{"ok":false,"reason":"no_face"|"bad_image"|"too_large"}`; 429 above 10 req/s. The image is never persisted.
  Embeddings are L2-normalized, so in SQL `1 - (embedding <=> '[...]'::vector)` is the cosine similarity.

## Run

```bash
cd workers/media
make venv          # python3 -m venv .venv && pip install -e ".[dev]"   (already done on this machine)
make models        # downloads YuNet (0.23 MB) + SFace (38.7 MB) from opencv_zoo via Git LFS, sha256-pinned
make dev           # API + consumer in one process      (= python -m hub_worker all)
make api           # API only                            (= python -m hub_worker api)
make consume       # consumer only                       (= python -m hub_worker consume)
make test          # pytest (job tests use the real local Postgres; model tests skip if models absent)
make bench DIR=/path/to/jpegs   # faces/photo, ms/photo, and precision/recall if labels.csv is present
```

Run several `consume` processes for throughput; claims use `FOR UPDATE SKIP LOCKED`.
A worker can also be restricted to some job types in code via `run_once(..., only_types=[...])`.

## Configuration

`hub_worker/config.py` loads the monorepo root `.env` by path (`../../.env` relative to the
package), so no symlink is needed and the cwd does not matter. Real environment variables win.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | | Prisma-migrated DB with the `vector` extension |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | | |
| `WORKER_PORT` | `8010` | |
| `FACE_MODEL_DIR` | `./models` | relative paths resolve against `workers/media` |
| `FACE_MATCH_THRESHOLD` | `0.363` | SFace cosine for "same person"; used for profile auto-matching |
| `FACE_CLUSTER_DISTANCE` | `1 - FACE_MATCH_THRESHOLD` (0.637) | agglomerative cut in cosine *distance*; see below |
| `FACE_MIN_QUALITY` | `0.3` | faces below this are stored but not clustered |
| `ZIP_PART_BYTES` | `2147483648` | |
| `WORKER_ID`, `WORKER_POLL_INTERVAL`, `WORKER_LOG_LEVEL` | host:pid, `1.0`, `INFO` | |

## Job semantics (what the web/admin apps should know)

- Claim: `UPDATE "Job" ... WHERE id = (SELECT id FROM "Job" WHERE status='QUEUED' AND "runAt" <= now() ORDER BY "runAt", id FOR UPDATE SKIP LOCKED LIMIT 1)`.
  `runAt` gates scheduling, so delayed/cron-like jobs are just rows with a future `runAt`.
- Success -> `SUCCEEDED`. Exception -> `lastError` set and, while `attempts < maxAttempts`, back to
  `QUEUED` with `runAt = now() + 10s * 2^(attempts-1)` (+-25 % jitter, capped at 1 h); otherwise `DEAD`.
  The row never rests in `FAILED` because the claim query only looks at `QUEUED`; "failed, retrying"
  is `status='QUEUED' AND "lastError" IS NOT NULL`.
- `RUNNING` rows locked for more than 60 min (crashed worker) are released once a minute.
- `finishedAt` is the end of the **latest** attempt: stamped on success and on every failure (retry, `DEAD`,
  stale-lock release); a `Requeue` return does not stamp it (it is not a failure, and its `lastError` starts
  with `requeued:`, which the dashboard does not count as "retrying"). It is reset to `NULL` when a job starts a
  fresh run: a dedupe re-enqueue (`jobs.enqueue`, TS `enqueue()`), admin Retry and "Retry dead". The admin Jobs
  dashboard reads it for "succeeded/failed in the last hour" and p50/p95 duration (`finishedAt - lockedAt`,
  successes only; failures clear `lockedAt`). Earlier failed attempts of a job that later succeeded are counted
  from `attempts - 1`.
- Heartbeat: `consume_forever` starts a `HeartbeatThread` with its own connection that upserts
  `WorkerHeartbeat(workerId = WORKER_ID or host:pid)` immediately and then every 10 s (the dashboard calls a
  worker live when seen < 30 s ago). It is a thread so a worker inside a long handler keeps beating and a
  crashed one (OOM kill) goes silent; the dashboard judges liveness from the heartbeat alone. A failed write is
  logged and retried next interval. Rows silent for 24 h are pruned in the minutely housekeeping (best effort).
  **Apply the Prisma migration `job_finished_at_worker_heartbeat` before starting a worker built from this
  code**: without the table the heartbeat only logs warnings, but the `finishedAt` writes in `mark_succeeded` /
  `mark_failed` fail and every job would retry.
  Give each process a distinct `WORKER_ID` (the default `host:pid` is unique): two processes sharing one id share
  one heartbeat row, so one of them dying is masked by the other. `consume_forever(worker_id=, only_types=,
  heartbeat_interval_s=)` lets a process (or a test) serve a subset of types under its own id.
- Cancelled jobs (admin "Cancel", only while `QUEUED`) become `DEAD` with `lastError = 'cancelled …'`; Retry,
  "Retry dead" (which revives them too) or a dedupe re-enqueue brings them back.
- `dedupeKey` enqueue (`jobs.enqueue`): insert, or on conflict refresh a `QUEUED` row (payload, later
  `runAt`), reset a `SUCCEEDED`/`DEAD`/`FAILED` row to `QUEUED`, and leave a `RUNNING` row alone.
  If the web app wants the same re-run semantics it should use the same `ON CONFLICT ... DO UPDATE ... WHERE status <> 'RUNNING'`
  rather than `DO NOTHING`; with `DO NOTHING` a second `faces:{photoId}` enqueue after a successful run is silently dropped.
- `CLUSTER_FACES` checks at the end whether photos were indexed while it ran and re-queues itself (+20 s) if so.
- Ids we generate (Face, FaceCluster, PhotoMatch): `'c' + 24 hex` (25 chars, cuid-shaped). `AuditLog.id` is the bigint sequence.

## Face pipeline notes

- Detection runs on a copy whose long edge is <= 1600 px (score 0.8, NMS 0.3, top-k 5000); faces
  narrower than 24 px there are dropped. `Face.bbox` is `{x,y,w,h}` normalized to 0..1 of the full image.
- `quality = score * min(1, width_px/80) * clip(laplacian_var/150, 0.2, 1)`.
- `modelVersion = "yunet-2023mar+sface-2021dec"`, 128-d, L2-normalized. Changing models means
  re-indexing (originals are kept) and marking `FaceProfile.stale`.
- Thresholds: OpenCV documents cosine >= 0.363 as "same person" for SFace. scikit-learn/scipy cosine
  *distance* is `1 - cos`, so the equivalent clustering cut is 0.637. Average linkage admits members on
  mean distance, so on large events with look-alike relatives 0.637 tends to over-merge; ~0.55 is a
  stricter starting point if purity matters more than recall. Measure with `scripts/bench_faces.py`
  on a labelled set (`labels.csv`: `filename,person`) before changing `FACE_CLUSTER_DISTANCE`.
- Memory: agglomerative clustering builds an n x n distance matrix (15k faces ~ 1.8 GB). Above that,
  shard by sub-event or switch to HDBSCAN.

## Layout

```
hub_worker/
  config.py     settings from ../../.env
  db.py         psycopg helpers, pgvector text adapters, id generation
  storage.py    boto3 client, key layout (mirrors packages/shared/src/storage.ts)
  jobs.py       enqueue / claim / backoff / consumer loop
  face.py       YuNet + SFace singletons, detect(), embed(), quality math
  imaging.py    orientation, EXIF capture time, resize, watermark
  api.py        FastAPI: /health, /embed-selfie
  handlers/     one module per job type
scripts/        download_models.py, bench_faces.py
tests/          unit tests + Postgres-backed consumer tests
```
