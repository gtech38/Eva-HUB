---
name: face-recognition-pipeline
description: Use when touching face detection, embedding, clustering, selfie search or biometric privacy: hub_worker/face.py, handlers/index_faces.py, cluster_faces.py, purge_face_index.py, api.py (/embed-selfie), apps/web/src/app/api/face/search/route.ts and gallery/me page. Covers YuNet+SFace models (download, licences, sha256), 128-d L2-normalized embeddings, FACE_MATCH_THRESHOLD and cluster distance, bbox normalization, quality score, the SQL match query, PhotoMatch/BiometricConsent/FaceProfile writes, what is biometric vs not, purge semantics, and scripts/bench_faces.py.
---

# Face recognition pipeline

## When this applies
- Any change to how faces are found, embedded, matched, clustered or purged.
- Consent copy, retention, "remember my face", guardian search.
- Tuning thresholds or swapping the model.

## Where things live

| Path | What |
|---|---|
| `workers/media/hub_worker/face.py` | YuNet (`cv2.FaceDetectorYN`, score 0.8, NMS 0.3, top-k 5000) + SFace (`cv2.FaceRecognizerSF`) singletons; `detect()` (long edge <= 1600, drops faces < 24 px, largest first), `embed()` (alignCrop + feature, L2-normalized 128-d), `normalize_bbox()`, `face_quality()` |
| `hub_worker/config.py` | `MODEL_VERSION = "yunet-2023mar+sface-2021dec"`, `FACE_MATCH_THRESHOLD` (0.363), `FACE_CLUSTER_DISTANCE` (default `1 - threshold` = 0.637), `FACE_MIN_QUALITY` (0.3), `FACE_MODEL_DIR` |
| `hub_worker/handlers/index_faces.py` | `INDEX_FACES {photoId}`: embed on the `web` derivative, replace `Face` rows, stamp `facesIndexedAt`, enqueue `CLUSTER_FACES` (dedupe `cluster:{eventId}`, +20 s) |
| `hub_worker/handlers/cluster_faces.py` | average-linkage agglomerative clustering (cosine), reconciles `FaceCluster` ids/labels/`suppressed`, `_match_profiles()` -> `PhotoMatch(PROFILE_AUTO)`, audit `faceindex.cluster`, self-`Requeue` on late arrivals |
| `hub_worker/handlers/purge_face_index.py` | deletes `Face` + `FaceCluster`, clears `Photo.facesIndexedAt`, sets `Event.faceIndexPurgedAt`, drops queued cluster job, audit `faceindex.purge`; keeps `PhotoMatch` |
| `hub_worker/api.py` | `POST /embed-selfie` (multipart `file`, 20 MB cap, 10 req/s token bucket) -> `{ok, embedding[128], model, faces, quality}` or `{ok:false, reason: no_face|bad_image|too_large|rate_limited}`; `GET /health` |
| `apps/web/src/app/api/face/search/route.ts` | production guard + consent freshness check (409 `consent_stale` before the worker is called), subject checks, forward selfie to worker, SQL match, visibility filter, write `PhotoMatch`/`BiometricConsent`/`AuditLog`, optional `FaceProfile` upsert (off: `FACE_PROFILE_ENROLMENT`) |
| `apps/web/src/app/sites/[slug]/gallery/me/page.tsx` + `components/gallery/FaceSearch.tsx` | consent UI (label/summary/full text from the consent files), subject picker (me / children in household), results, previous matches; posts `consentVersion`/`consentLocale` |
| `apps/web/src/lib/face.ts` | `FaceSearchReason` |
| `legal/consent/v<N>/{search_self,search_guardian,face_profile}.{en,te,hi}.md` + `packages/shared/src/consent.ts` | versioned consent texts (front matter: `version`, `effective`, `kind`, `locale`, `status`, `reviewed_by`, `translation`, `label`, `summary`), bundled via `?raw` (server-only by convention). `CONSENT_VERSIONS` (every published dir), `CURRENT_CONSENT_VERSION`, `consentText(kind, locale, version?)`, `consentRecordVersion(kind)` -> `SEARCH_SELF:v1-2026-10` stored on `BiometricConsent`, `parseConsentRecordVersion`, `unreviewedConsentDocs` |
| `apps/web/src/lib/faceConsent.ts` | `checkConsentSubmission` (kind/version/locale must match the current text), `mayEnrolFaceProfile`, `FACE_PROFILE_ENROLMENT = false` until WEB-006 revoke, `faceSearchAllowed(NODE_ENV)` production guard (unreviewed text -> disabled) |
| `apps/web/src/lib/consentTexts.ts` (server) / `consentView.ts` (client-safe types + `consentFor`), `components/gallery/ConsentText.tsx`; admin `/platform/legal` | full text behind "What you're agreeing to" under each consent checkbox; read-only admin listing of every version |
| `apps/admin/.../events/[eventId]/settings/page.tsx` + `actions.ts` | `faceSearchEnabled`, retention override (30-730), "Purge face index now" (`PURGE_FACE_INDEX`), gallery `reindexFaces` (`CLUSTER_FACES`) |
| `scripts/download_models.py`, `scripts/bench_faces.py` | model fetch (LFS pointer -> media.githubusercontent, sha256 pinned), accuracy/throughput bench |
| `tests/test_face_synthetic.py` | geometry/quality/embedding unit tests; model-backed tests skip without ONNX |

## Models and licences
| Model | File | Licence | sha256 (pinned in `download_models.py`) |
|---|---|---|---|
| YuNet 2023mar (detect) | `face_detection_yunet_2023mar.onnx` (0.23 MB) | MIT | `8f2383e4...52fa4` |
| SFace 2021dec (embed) | `face_recognition_sface_2021dec.onnx` (38.7 MB) | Apache-2.0 | `0ba9fbfa...34e79` |
Both from opencv_zoo. `*.onnx` is git-ignored; `make models` fetches. Switching models = new `MODEL_VERSION`, re-index every event, set `FaceProfile.stale = true` (embeddings do not convert).

## Conventions in this repo
- **Embeddings are 128-d float32, L2-normalized** -> cosine similarity is a dot product and pgvector `1 - (a <=> b)`. `Face.embedding`/`FaceProfile.embedding` are `vector(128)`; the web route asserts `embedding.length === 128` and every value finite before inlining the literal.
- **Thresholds:** similarity >= `FACE_MATCH_THRESHOLD` (0.363, OpenCV's SFace "same person" value) for search and profile auto-match; clustering cuts at cosine *distance* `FACE_CLUSTER_DISTANCE` (0.637). Average linkage over-merges on big weddings; ~0.55 is the stricter candidate. Measure before changing (bench).
- **bbox** is `{x,y,w,h}` normalized 0..1 of the analyzed image (same ratios as the full image), rounded to 5 dp.
- **quality** = `score * min(1, width_px/80) * clip(laplacian_var/150, 0.2, 1)`; faces below `FACE_MIN_QUALITY` are stored but not clustered.
- **Match SQL** (web route and `_match_profiles` are the same shape): `SELECT f."photoId", MAX(1 - (f.embedding <=> $vec)) AS score FROM "Face" f JOIN "Photo" p ... LEFT JOIN "FaceCluster" c ... WHERE f."eventId" = $event AND p.status='READY' AND NOT p.hidden AND COALESCE(c.suppressed,false)=false GROUP BY f."photoId" HAVING MAX(...) >= $thr ORDER BY score DESC LIMIT 500`. Exact scan, no ANN index (<= ~15k faces per event).
- **Then album visibility** via `visiblePhotoWhere(eventId, viewer, { id: { in } })` -- face results never bypass gallery rules.
- **Writes per search (one transaction):** `PhotoMatch` upsert (`SELFIE` keyed `userId_photoId`, or `GUARDIAN` keyed `subjectGuestId_photoId`), `BiometricConsent` (`SEARCH_SELF` | `SEARCH_GUARDIAN`, `consentTextVersion = consentRecordVersion(kind)` e.g. `SEARCH_SELF:v1-2026-10`, salted `ipHash`), `AuditLog face.search` with kind, `consentVersion`, `locale`, candidate/visible counts. Before any of that (and before the worker call) the client-posted `consentVersion` + `consentLocale` must equal the current `KIND:version` and a shipped locale, else 409 `consent_stale` (client shows the message and `router.refresh()`es). Only when `FACE_PROFILE_ENROLMENT` is on (currently off), with `remember=on`, a matching `profileConsentVersion` and an adult guest self-search: `BiometricConsent FACE_PROFILE` (eventId null) + raw `INSERT ... ON CONFLICT ("userId") DO UPDATE` into `FaceProfile` (`purgeAfter = now + 3 years`) + audit `consent.grant`.
- **Who may be searched (one rule, `apps/web/src/lib/faceSubject.ts`):** `resolveFaceSubject(viewer, eventId, subject)` is used by POST `/api/face/search`, GET `/api/gallery/me` and the `/gallery/me` page; `listSearchableChildren` feeds the subject picker. "me" (or null) is the viewer, refused with `opted_out` if their own guest row has `faceSearchOptOut`; anything else must be a live `isChild` guest of the viewer's household in this event (`forbidden` otherwise, `opted_out` if that child opted out). `PhotoMatch` rows are not purged on opt-out, so **reads of earlier matches must go through the same rule**: `/api/gallery/me` answers 403 `opted_out` (404 for unknown/foreign ids) and `previousMatchFeeds` shows no "Photos of you" for an opted-out adult. Never query `PhotoMatch` for a subject without it.
- **Guardian search:** subject must be an `isChild` guest in the viewer's household, not `faceSearchOptOut`; no profile is ever created for a child. Results attach to the child's guest row and show under "Family photos".
- **Per-event switch:** `Event.faceSearchEnabled` gates the route (400 `disabled`), the "Find me" link, and `INDEX_FACES` (skips). `Guest.faceSearchOptOut` returns `opted_out`. `FaceCluster.suppressed` ("remove me") excludes a cluster from matching and survives re-clustering by majority vote.
- **Retention:** `Event.faceIndexPurgeAt = galleryPublishedAt + (event override ?? studio default) days`, recomputed on settings changes (admin actions audit `event.retention.change` / `studio.retention.change`). Admins can purge now. Nothing yet schedules the purge automatically at `faceIndexPurgeAt` (docs/04: Phase 2) -- a `PURGE_FACE_INDEX` job with `runAt` is the intended mechanism.

## Biometric vs not
| Biometric (purged / revocable) | Not biometric (kept) |
|---|---|
| `Face.embedding` (+ bbox/quality rows), `FaceCluster` | `PhotoMatch` (photo ids + scores) |
| `FaceProfile.embedding` | `BiometricConsent` (who/when/what version) |
| Selfie bytes: processed temporarily in web (forwarded `File`) and worker (`del data`), never saved by our code, never logged. Not "memory only": Starlette spools multipart uploads over 1 MB to a temp file, so consent copy must not claim memory-only | `AuditLog` counts |

## Common tasks

### Change a threshold
1. Bench: `make bench DIR=/path/to/labelled/jpegs` with `labels.csv` (`filename,person`); read "best F1 at cosine >= X (cluster distance 1-X)".
2. Set `FACE_MATCH_THRESHOLD` / `FACE_CLUSTER_DISTANCE` in `.env` (web reads `FACE_MATCH_THRESHOLD` via `env()`, worker via `settings`). Keep them consistent.
3. Re-cluster: admin Gallery -> "Re-run face clustering" (`reindexFaces` enqueues `CLUSTER_FACES`).
4. Test first if changing defaults in code: update `test_backoff`-style constants tests in `tests/test_face_synthetic.py` (e.g. `face_quality` expectations).

### Add a new search error reason
1. Test first: unit test for the worker (`api.py`) or a vitest test (`apps/web/src/lib/<name>.test.ts`) for a pure helper mapping reasons -> strings.
2. Worker returns `{ok:false, reason}`; web route maps it to a status (`fail(reason, 422)`); add the key to `FaceSearchReason` and to `faceStrings().errors` in `gallery/me/page.tsx` in en/te/hi.

### Change consent copy
Never edit a published version. Copy the current `legal/consent/v<N>/` to `v<N+1>/`, edit there (body, `label` and `summary` are all versioned), set a new `version:` in all nine files, add the nine `?raw` imports + a `BUNDLED` entry in `packages/shared/src/consent.ts` and move `CURRENT_DIR`. Keep old directories bundled forever (rules in `legal/consent/README.md`). Copy must describe only what exists today (no automation or self-service that is not shipped). Production stays disabled until LEG-006 fills `reviewed_by`. Legal review is a design input (docs/01 §6, LEG-006).

### Re-index an event after a model change
Set new `MODEL_VERSION`, run `make models`, enqueue `INDEX_FACES` for each READY photo (`dedupeKey faces:{photoId}`), then `CLUSTER_FACES`; mark profiles stale: `UPDATE "FaceProfile" SET stale = true;`.

## Gotchas
- `web` posts to `WORKER_INTERNAL_URL` (`http://localhost:8010`) with a 20 s timeout; worker down -> 503 `unavailable`, UI shows the "temporarily unavailable" string.
- Phone selfies are EXIF-rotated; the worker decodes with Pillow (`open_oriented`) before OpenCV, otherwise YuNet finds nothing.
- `/embed-selfie` picks the largest face; multiple faces are allowed (`faces` is returned) -- the `multiple_faces` reason exists in web strings but the worker never emits it.
- `PhotoMatch` has two unique keys and the CHECK `PhotoMatch_one_subject` (exactly one of `userId`/`subjectGuestId`; DB-001). Every insert must set exactly one subject. Deleting a `User` cascades to their matches (`onDelete: Cascade`; `SET NULL` would violate the CHECK). Guardian matches (`subjectGuestId`) have no FK and are removed explicitly. See `prisma-postgres`.
- `CLUSTER_FACES` dedupe is a no-op while RUNNING; the handler re-queues itself when photos were indexed during the run. Do not "fix" by removing the dedupe key.
- Clusters are per event; there is deliberately no cross-event "who is this" lookup, and profiles only match events where the user is a non-deleted guest with unrevoked consent.
- Hidden albums (`HIDDEN`) are excluded from profile auto-match in SQL but the selfie route relies on the later `visiblePhotoWhere` filter; both end at the same visibility.
- Studio owners/staff cannot selfie-search (`can("face.search")` is hosts/guests only) -- by design, tested in `policy.test.ts`.

## Verification
```bash
cd workers/media && make models && make test        # model-backed tests no longer skipped
curl -s -F file=@/path/selfie.jpg localhost:8010/embed-selfie | jq '.ok, (.embedding|length), .faces'
# end-to-end: upload photos in admin, wait for READY, sign in as a guest, /gallery/me -> search; then
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT source,count(*) FROM "PhotoMatch" GROUP BY 1; SELECT kind,count(*) FROM "BiometricConsent" GROUP BY 1;'
```

## References
- `docs/01-architecture.md` §6 (pipeline, "remember my face", guardian search, model licensing, CUBI)
- `docs/03-data-model.md` §2.9-2.10 (where biometric data lives; PhotoMatch is not biometric)
- `workers/media/README.md` "Face pipeline notes"
- OpenCV YuNet/SFace: https://github.com/opencv/opencv_zoo/tree/main/models
- pgvector operators: https://github.com/pgvector/pgvector#querying
- Related skills: `python-media-worker`, `prisma-postgres`, `guest-site-patterns`
