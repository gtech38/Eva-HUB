---
id: WRK-009
title: Clustering threshold tuning with regression fixtures
labels: [type:feature, area:worker, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [WRK-008]
epic: EPIC-FACE
---

## Context
`FACE_CLUSTER_DISTANCE` defaults to `1 - FACE_MATCH_THRESHOLD` (0.637); the worker README says this over-merges look-alike relatives and suggests ~0.55. WRK-008 produces measured values; this ticket bakes them in with tests so future changes are deliberate.

## Scope
- Apply the WRK-008 thresholds as defaults in `config.py` and `.env.example`; keep env overrides.
- Fixture `tests/fixtures/embeddings_small.npz`: 60 synthetic L2-normalised 128-d vectors in 6 identities generated deterministically (seeded Gaussian around 6 random centres with controlled intra/inter distances) plus 2 "look-alike" identities 0.5 apart; test that `cluster_embeddings` at the chosen distance yields 8 clusters with purity 1.0, and that 0.75 merges the look-alikes (documents the failure mode).
- Test for `_reconcile_clusters`: ids and `suppressed` survive a re-run where two clusters merge or one splits.
- Quality gate test: faces below `FACE_MIN_QUALITY` are stored but `clusterId` is NULL.
- Document the chosen numbers in the worker README table.

## Out of scope
- Model change (separate decision). HDBSCAN (note as follow-up if > 15k faces).

## Acceptance criteria
- [ ] New pytest cases pass with the chosen defaults and fail if `FACE_CLUSTER_DISTANCE` is raised to 0.75.
- [ ] README and `.env.example` agree with `config.py`.

## Files
- `workers/media/hub_worker/config.py`, `workers/media/tests/test_cluster.py` (new), `workers/media/tests/fixtures/embeddings_small.npz`, `workers/media/README.md`, `.env.example`

## Verification
```bash
cd workers/media && make test -- -k cluster
```

## Notes for agents
Write the look-alike merge test first (it should fail at 0.75 and pass at the chosen value). Generate the fixture with a committed script, not by hand.
