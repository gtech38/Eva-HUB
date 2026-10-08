---
id: EPIC-FACE
title: Face search pipeline: accuracy, lifecycle, retention and controls
labels: [type:epic, area:worker, priority:p0, size:L]
milestone: Phase 1 — MVP
---

## Context
YuNet + SFace indexing, agglomerative clustering, selfie search, guardian search, "remember my face" profiles and `PURGE_FACE_INDEX` are implemented (`workers/media/hub_worker`, `apps/web/src/app/api/face/search/route.ts`). Unmeasured and unfinished: accuracy on a real wedding set (docs/04 §5 step 3 — this decides whether SFace is good enough), clustering threshold (README notes 0.637 over-merges), profile notifications and `lastUsedAt` refresh, stale profiles on model change, a scheduler that actually enqueues purges, the guest "remove me" control, host labels, and a GPU option. Biometric compliance (EPIC-LEGAL) depends on the retention pieces here.

## Children
- WRK-008 Spike: face recognition accuracy on a real wedding set
- WRK-009 Clustering threshold tuning with regression fixtures
- WRK-010 Face-profile lifecycle: notifications, lastUsedAt refresh, stale on model change
- WRK-012 Scheduler tick: face-index and face-profile purges
- WEB-021 "Remove me from face search" guest control
- ADM-018 Host-labelled clusters and People browse view
- WRK-013 GPU / ONNX Runtime execution option
- WEB-029 Re-enable "Remember my face" enrolment once revoke ships

## Definition of Done
- [ ] Precision/recall of self-search on the benchmark set is recorded and the model decision is documented in an ADR.
- [ ] Every event past `faceIndexPurgeAt` is purged within 24 h without manual action; profiles unused for 3 years are purged.
- [ ] A guest can remove themselves from face search and stays removed after re-indexing.
- [ ] Profile owners are notified when a new gallery matches them.
