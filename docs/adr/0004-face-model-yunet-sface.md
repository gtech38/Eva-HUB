# ADR-0004: YuNet and SFace (OpenCV Zoo) instead of InsightFace weights

- Status: Accepted
- Date: 2026-10-08
- Tickets: WRK-008, WRK-009, WRK-010, WRK-013

## Context

Guests find their photos by selfie search over a self-hosted face index. docs/01 section 6 notes that InsightFace's code is MIT but its common pretrained weights (`buffalo_l`, ArcFace r100) are non-commercial research only, so a paid product needs a commercial licence or different weights. Quality on real wedding sets is not yet measured (docs/04 asks for a spike).

## Decision

Detection is YuNet (`face_detection_yunet_2023mar.onnx`) and embedding is SFace (`face_recognition_sface_2021dec.onnx`), both from OpenCV Zoo (MIT and Apache-2.0), run on CPU through OpenCV's DNN module. `make models` downloads them with pinned sha256 digests; they are not committed. Embeddings are 128-d and L2-normalised, so cosine similarity equals the dot product and matches pgvector's `<=>`; the default match threshold is cosine 0.363 (`FACE_MATCH_THRESHOLD`), the OpenCV-documented "same person" value. Every `Face` and `FaceProfile` row stores `modelVersion` (currently `yunet-2023mar+sface-2021dec`) next to its `vector(128)`, so a model change is detectable, rows can be re-indexed from the kept originals, and profiles can be marked stale.

## Consequences

- No licence negotiation or cost; accuracy on hard angles, children and low light is below ArcFace and unmeasured. WRK-008 benchmarks it on a real set and either confirms this ADR or supersedes it with the numbers.
- Changing model means a new vector dimension or semantics: re-index every event (`INDEX_FACES`), mark `FaceProfile.stale` (WRK-010), and update the SQL that hard-codes `vector(128)`.
- Thresholds (`FACE_MATCH_THRESHOLD`, `FACE_CLUSTER_DISTANCE`, `FACE_MIN_QUALITY`) are provisional until WRK-009 pins them with fixtures. GPU runtime is an option, not a requirement (WRK-013).
- Biometric storage rules are unchanged: embeddings live only in `Face`, `FaceCluster` and `FaceProfile`.

## Alternatives

- InsightFace with a commercial licence: best accuracy, 512-d, paid; revisit if WRK-008 shows SFace is not good enough.
- InsightFace pretrained weights without a licence: not permitted for a commercial product.
- Self-trained ArcFace on a commercially usable dataset: judged not worth it at this stage (docs/01 section 6).

## References

- `workers/media/hub_worker/face.py`
- `workers/media/hub_worker/config.py`
- `workers/media/scripts/download_models.py`
- `workers/media/scripts/bench_faces.py`
- `packages/db/prisma/schema.prisma`
- `docs/01-architecture.md` section 6
