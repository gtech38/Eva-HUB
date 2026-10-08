---
id: WRK-008
title: Spike: face recognition accuracy on a real wedding set (SFace vs commercial, thresholds)
labels: [type:spike, area:worker, priority:p0, size:M]
milestone: Phase 1 — MVP
epic: EPIC-FACE
---

## Context
docs/04 §5 step 3: "Spike the face pipeline on a real 1,000-photo wedding set: precision and recall of YuNet + SFace with clustering, and throughput per vCPU. This decides whether SFace is good enough before the UI is built on top of it." docs/01 §6 "Model licensing (decision needed)". `workers/media/scripts/bench_faces.py` computes pairwise precision/recall and best-F1 threshold from a `labels.csv`.

## Scope
- Assemble a labelled set: ≥ 800 photos from one real wedding (with the host's permission; keep the set outside the repo), `labels.csv` with ≥ 25 identities × ≥ 10 photos each, including kids, side profiles, low light, and 10 "selfie" images taken on phones.
- Run `make bench DIR=...` at `--max-edge 1600` and `2000`; record faces/photo, ms/photo, pairwise P/R at 0.363 and at best-F1; add a `--cluster` mode to the script that runs `cluster_embeddings` at 0.55/0.60/0.637/0.70 and reports purity and completeness per identity.
- Selfie → cluster recall: for each selfie, top-cluster hit rate at the candidate thresholds (this is the user-visible metric).
- Guardian case: child identities measured separately.
- Compare against one commercial option on the same set if a trial licence is obtainable (InsightFace); otherwise document the quote and skip.
- Output: `docs/adr/000X-face-model.md` (decision + numbers) and recommended `FACE_MATCH_THRESHOLD`, `FACE_CLUSTER_DISTANCE`, `FACE_MIN_QUALITY` values; open follow-up tickets if the decision is to switch models.

## Out of scope
- Shipping any code beyond the bench script changes. Tuning (WRK-009 implements the chosen values with fixtures).

## Acceptance criteria
- [ ] ADR committed with the numbers table and a clear decision (keep SFace / switch / switch later with trigger).
- [ ] Recommended thresholds recorded in `.env.example` comments.
- [ ] `bench_faces.py --cluster` merged with a smoke test on synthetic embeddings.

## Files
- `workers/media/scripts/bench_faces.py`, `workers/media/hub_worker/handlers/cluster_faces.py` (read), `docs/adr/` (DOC-010 template), `.env.example`

## Verification
```bash
cd workers/media && make bench DIR=/path/to/set
python scripts/bench_faces.py /path/to/set --cluster
```

## Notes for agents
Time-box to two days. Never commit photos or embeddings of real people. The output is a decision, not a feature.
