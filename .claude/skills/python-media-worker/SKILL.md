---
name: python-media-worker
description: Use when working in workers/media (Python 3.13 job consumer + FastAPI): venv and Makefile targets (dev|api|consume|test|models|bench), config.py env loading, jobs.py consumer semantics (SKIP LOCKED claim, backoff, DEAD, dedupe, stale-lock release, Requeue), registering a handler, adding a job type on both the Python and TS sides, Pillow derivatives and watermark (imaging.py), psycopg and S3 patterns, reading logs, and the pytest layout in tests/.
---

# Python media worker (workers/media)

## When this applies
- New or changed job handler, job type, derivative size, watermark, or the `/embed-selfie` API.
- Jobs stuck in QUEUED/RUNNING/DEAD on the admin Jobs page.
- Running or testing the worker locally.

## Where things live

| Path | What |
|---|---|
| `workers/media/Makefile` | `venv`, `models`, `dev` (api + consumer thread), `api`, `consume`, `test`, `bench DIR=` -- all via `.venv/bin/python` |
| `workers/media/pyproject.toml` | deps: opencv-contrib-python-headless, numpy, pillow, psycopg[binary], fastapi, uvicorn, python-multipart, boto3, python-dotenv, scikit-learn; dev: pytest; `testpaths = ["tests"]` |
| `hub_worker/__main__.py` | `python -m hub_worker api|consume|all`; logging format `%(asctime)s %(levelname)s %(name)s: %(message)s` |
| `hub_worker/config.py` | `settings` dataclass from root `.env` (resolved by path `../../../.env`, real env wins); `MODEL_VERSION`, model file names; `FACE_MODEL_DIR` relative to `workers/media` |
| `hub_worker/db.py` | `connect(autocommit)`, `transaction(conn)`, `new_id()` (cuid-shaped), `utcnow()`, `jsonb()`, `vec_literal()`, `parse_vec()`, `l2_normalize()`, `cosine_sim()` |
| `hub_worker/jobs.py` | `enqueue()`, `claim()`, `mark_succeeded/requeued/failed()`, `requeue_stale()`, `Requeue`, `default_handlers()`, `run_once()`, `consume_forever()` |
| `hub_worker/handlers/process_photo.py` `sort_key()` | `Photo.sortKey` = capture time (else `createdAt`) as naive fixed-width ISO with milliseconds (`2026-03-04T05:06:07.089`); the web gallery pages by `sortKey ASC NULLS LAST, id ASC` and `build_zip.py` uses the same order (docs/03 "Photo.sortKey contract"; pinned by `tests/test_process_photo_sort_key.py`, which also compares against Postgres `to_char`) |
| `hub_worker/handlers/*.py` | one `handle(conn, job)` per type: `process_photo`, `index_faces`, `cluster_faces`, `purge_face_index`, `build_zip`, `send_message` (stub), `fire_reminder` (stub: stamps `firedAt`), `print_submit` (stub) |
| `hub_worker/imaging.py` | `open_oriented`, `captured_at`, `fit_long_edge`, `to_jpeg`, `watermark`, `make_variants` (thumb 400/q80, web 2048/q85, webWm) |
| `hub_worker/storage.py`, `face.py`, `api.py` | see `s3-object-storage`, `face-recognition-pipeline` |
| `tests/conftest.py` | shared `conn` fixture (skips if DB down) and per-test `queue` fixture (`IsolatedJobQueue`: private `TEST_<LABEL>_<uuid8>` type, claims asserted by id, every enqueued row deleted at teardown; sweeps `TEST_*` rows older than 1 h) |
| `tests/test_jobs.py` | consumer semantics against the real local Postgres (skips if DB down); must not share a database with a running consumer (see Write a Postgres-backed test) |
| `tests/test_face_synthetic.py` | pure unit tests + model-backed tests (skip if ONNX files absent) |
| `scripts/download_models.py`, `scripts/bench_faces.py` | models (sha256-pinned, Git LFS aware), accuracy/throughput bench |
| `workers/media/README.md` | job table, env table, semantics -- keep it updated |

## Conventions in this repo
- **Handlers are `handle(conn, job) -> None | Requeue`.** `conn` is autocommit; wrap atomic sections in `with conn.transaction():`. Raise to fail (recorded on the row, retried with backoff); return `Requeue(delay_s, reason)` to come back later without burning an attempt.
- **Raw SQL with psycopg 3, dict rows.** Quote camelCase identifiers (`"photoId"`), cast enums (`'READY'::"PhotoStatus"`), pass vectors as `%s::vector` with `vec_literal()`, JSON via `jsonb()`.
- **Idempotent handlers.** `INDEX_FACES` deletes then re-inserts the photo's faces; `CLUSTER_FACES` reconciles cluster ids; `PURGE_FACE_INDEX` locks the event row. A job may run twice (stale lock release); design for it.
- **Logging:** stdlib `logging`, logger per module (`log = logging.getLogger(__name__)`), one summary line per job with timings in ms. `WORKER_LOG_LEVEL` env. botocore/urllib3 are set to WARNING.
- **State machine:** QUEUED -claim-> RUNNING -> SUCCEEDED | QUEUED (retry, `lastError` set, `runAt = now + 10s*2^(attempts-1)` +-25 %, cap 1 h) | DEAD (attempts >= maxAttempts, default 5). RUNNING rows locked > 60 min are released once a minute (`requeue_stale`, counts as a failed attempt). The row never rests in FAILED. `finishedAt` is stamped on success and on every failure; admin Cancel turns a QUEUED row into DEAD (`lastError` "cancelled …").
- **`finishedAt`** = end of the latest attempt: stamped by `mark_succeeded`, `mark_failed` (retry and DEAD) and `requeue_stale`; **not** by a `Requeue` return (not a failure; its `lastError` starts `requeued:`, which the dashboard does not count as retrying). Cleared (`NULL`) whenever a job starts a fresh run: dedupe re-enqueue (Python and TS), admin Retry, "Retry dead". Any new code path that re-queues a finished job must clear it too. Apply the `job_finished_at_worker_heartbeat` migration before starting a worker that writes it.
- **Heartbeat:** `consume_forever(worker_id=, only_types=, heartbeat_interval_s=)` starts a `HeartbeatThread` (own connection) that upserts `WorkerHeartbeat` immediately and every `HEARTBEAT_INTERVAL_S` (10 s; the dashboard's live window is 30 s). It is a thread so a worker inside a long handler keeps beating and a crash goes silent; the dashboard judges liveness from the heartbeat alone (no "holds a RUNNING lock" override). A failed write (any exception) or prune is logged, never fatal. A clean stop deletes the row (the worker leaves the dashboard at once); rows of killed workers are pruned after 24 h in the minutely housekeeping. Without the `job_finished_at_worker_heartbeat` migration the consumer exits on its first housekeeping pass (`UndefinedColumn`). Give each process a distinct `WORKER_ID` (default `host:pid`): a shared id shares one heartbeat row and masks a death.
- **Payloads carry `eventId`** (and `studioId` when known) so per-event admin views and logs can scope a job by `payload->>'eventId'`; `PROCESS_PHOTO` forwards them to `INDEX_FACES`. Handlers still read only the ids they need.
- **Dedupe:** `enqueue(..., dedupe_key=)` uses `ON CONFLICT ("dedupeKey") DO UPDATE ... WHERE status <> 'RUNNING'` (see table in `prisma-postgres`). A handler that may be bypassed while RUNNING must detect late work itself (`cluster_faces` checks `facesIndexedAt > lockedAt`).
- `run_once(conn, handlers, only_types=[...])` lets a process serve a subset (tests use per-test `TEST_*` types so a dev server's real jobs are untouched; the reverse is not true, see below).
- The worker only touches `Job`, `Photo`, `Studio.brandJson`, `Event`, `Face`, `FaceCluster`, `FaceProfile`, `BiometricConsent`, `PhotoMatch`, `Guest`, `Album`, `ZipExport`, `ReminderRule`, `AuditLog`. Prisma owns the schema; never DDL from Python.

## Running

```bash
cd workers/media
make venv                 # once; python3 -m venv .venv (3.13 on this machine) + pip install -e ".[dev]"
make models               # YuNet + SFace ONNX into ./models (sha256 verified)
make dev                  # API on :8010 + consumer thread (= python -m hub_worker all)
make api | make consume   # separately; run several `make consume` for throughput
make test                 # pytest -q
make bench DIR=/path/to/jpegs
curl -s localhost:8010/health   # {"ok":true,"models_loaded":...,"models_present":...,"model":"yunet-2023mar+sface-2021dec"}
```
Logs go to stdout of that terminal; look for `job <id> <TYPE> succeeded in N ms` / `failed (attempt a/b) -> QUEUED|DEAD`. The admin page `http://localhost:3001/platform/jobs` shows counts, `lastError`, and a Retry button for FAILED/DEAD (`retryJob` resets attempts).

## Common tasks

### Add a job type (e.g. `DELETE_PHOTO_OBJECTS`)
1. Test first (Python): `tests/test_delete_photo_objects.py` -- monkeypatch `hub_worker.storage.delete`/`client` with a fake, call `handlers.delete_photo_objects.handle(conn, {"payload": {...}, "id": 1, "attempts": 1, "maxAttempts": 5})`, assert the keys deleted. Use the `conn` fixture pattern from `test_jobs.py` (skip if DB down) only if the handler reads the DB.
2. Test first (TS): extend a vitest test (`packages/*/src/*.test.ts` style) for the enqueue call site, or at minimum type-level: adding the literal to `JobType` makes `enqueue("DELETE_PHOTO_OBJECTS", ...)` compile.
3. Python: `hub_worker/handlers/delete_photo_objects.py` with `handle(conn, job)`; register in `default_handlers()` and `JOB_TYPES` in `jobs.py`.
4. TS: add to `JobType` in `packages/db/src/index.ts`; update the `Job.type` comment in `schema.prisma`; enqueue from the action with a `dedupeKey` (`delobj:{photoId}`), inside the same transaction when possible (`enqueue(..., { tx })`).
5. Document the row in `workers/media/README.md` job table.
6. `make test && pnpm typecheck`.

### Change derivative sizes or watermark
Edit constants in `imaging.py` (`THUMB_EDGE`, `WEB_EDGE`, qualities; `watermark(opacity=0.28, angle=30)`), update `test_fit_long_edge_and_variants` expectations first, run `make test`. Re-process existing photos by enqueueing `PROCESS_PHOTO` with `dedupeKey process:{photoId}` (admin has no button yet; use `prisma db execute` or a small tsx script).

### Add an env setting
Add a field to `Settings` in `config.py`: put the key and its literal local default (or `None` if derived) in `DEFAULTS`, read it with `get("KEY")` in `load_settings()`, add metadata to `scripts/env-meta.mjs`, then `pnpm env:docs` regenerates `.env.example` and `docs/deploy/env.md` (`node scripts/env-docs.mjs --check` fails otherwise). If the setting is wrong-by-default in production, add it to `PRODUCTION_REQUIRED` so `load_settings()` warns. `_float()` still strips inline `# comments` for hand-written `.env` files.

### Write a Postgres-backed test
Use the `conn` and `queue` fixtures from `tests/conftest.py` (module-scoped `connect(autocommit=True)`, `pytest.skip` on `OperationalError`; `queue` gives a private job type, `queue.run_job(handlers, job_id)` asserts the claimed id, and every `jobs.enqueue` during the test is tracked and deleted at teardown). Use unique ids (`uuid4`) and `TEST_*` types/keys so parallel dev traffic is unaffected.

The DB-backed tests must not share a database with a running consumer (`make dev` / `make consume`): a consumer started without `only_types` claims every due row, `TEST_*` ones included. Point the suite at its own database (or stop the consumer) before running it.

## Gotchas
- `make test` silently skips DB tests when Postgres is down and model tests when ONNX files are missing -- a green run may be partial. `pytest -ra` (set in `addopts`) prints the skip reasons; read them.
- Consumer and API in one process (`make dev`): a crash in the consumer thread does not stop uvicorn; watch for `consumer stopped` in logs.
- `FaceDetectorYN` is not thread-safe; `face.detect()` holds a lock. Scale with processes, not threads.
- Pillow `Image.MAX_IMAGE_PIXELS` is raised to 400 MP; a corrupt/huge file can still exhaust memory on a small worker.
- `PROCESS_PHOTO` marks the photo FAILED on exception but the job itself retries; after `maxAttempts` the photo stays FAILED and the admin Uploader shows "Processing failed (see Jobs)".
- Clustering builds an n x n matrix: ~1.8 GB at 15k faces. Above that shard or switch to HDBSCAN (README).
- `python3` on this Mac is 3.14 but the venv is 3.13; always use `.venv/bin/python` (the Makefile does).
- `FIRE_REMINDER`, `SEND_MESSAGE`, `PRINT_SUBMIT` are stubs; scheduling a reminder in admin produces a job that only stamps `ReminderRule.firedAt`.
- The enqueue payload from admin for `PROCESS_PHOTO` includes `eventId`/`studioId`; the handler only reads `photoId` (fine, but do not rely on extra keys without checking the enqueuer).

## Verification
```bash
cd workers/media && make test                                  # expect "passed", read any "SKIPPED" lines
.venv/bin/python -m pytest -q tests/test_jobs.py -ra           # DB semantics only
curl -s localhost:8010/health
docker compose -f ../../infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT type,status,count(*) FROM "Job" GROUP BY 1,2 ORDER BY 1,2;'
```

## References
- `workers/media/README.md` (authoritative for job payloads, env, thresholds)
- `docs/01-architecture.md` §5 (pipeline; says pyvips -- the code uses Pillow) and §2 (queue/scheduler rationale)
- psycopg 3: https://www.psycopg.org/psycopg3/docs/
- Pillow: https://pillow.readthedocs.io/
- Related skills: `prisma-postgres`, `face-recognition-pipeline`, `s3-object-storage`, `tdd-workflow`
