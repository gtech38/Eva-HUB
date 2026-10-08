---
id: WRK-013
title: GPU / ONNX Runtime execution option for detection and embedding
labels: [type:feature, area:worker, priority:p3, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [WRK-008]
epic: EPIC-FACE
---

## Context
docs/04 Phase 3: "Optional GPU worker pool." Today `face.py` uses OpenCV DNN (`cv2.FaceDetectorYN`, `cv2.FaceRecognizerSF`) on CPU, ~0.3–0.6 s per photo. Multiple studios or a backlog of events would benefit from a faster path without changing embeddings.

## Scope
- `FACE_BACKEND=opencv|onnxruntime` setting; `onnxruntime` backend loads the same `.onnx` files with `onnxruntime` (`CUDAExecutionProvider` when available, else CPU) and reproduces YuNet post-processing (priors, NMS) and SFace alignment in NumPy; embeddings must match OpenCV's within cosine ≥ 0.999 on the synthetic tests and the bench set.
- `pyproject.toml` optional extra `gpu = ["onnxruntime-gpu"]`; `Dockerfile.worker` build arg to pick the extra (INF-015 owns the Dockerfile).
- `only_types` worker mode documented: a GPU replica consuming only `INDEX_FACES`/`CLUSTER_FACES`.
- Bench: `bench_faces.py --backend` to compare ms/photo.

## Out of scope
- Model change. Batch inference across photos (follow-up if needed).

## Acceptance criteria
- [ ] pytest: for 20 synthetic/aligned crops, OpenCV and ORT embeddings have cosine ≥ 0.999; detections match within 2 px.
- [ ] With `FACE_BACKEND=onnxruntime` on CPU, all existing tests pass.
- [ ] README table documents backend selection and the GPU extra.

## Files
- `workers/media/hub_worker/face.py` → `face/{__init__,opencv_backend,ort_backend}.py`, `workers/media/pyproject.toml`, `workers/media/scripts/bench_faces.py`, `workers/media/tests/test_backends.py` (new), `workers/media/README.md`

## Verification
```bash
cd workers/media && FACE_BACKEND=onnxruntime make test
```

## Notes for agents
First failing test: embedding parity. `MODEL_VERSION` must not change between backends; if parity cannot be reached, the backend is not shippable.
