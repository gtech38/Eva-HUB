---
id: ADM-018
title: 'Host-labelled clusters and a "People" browse view'
labels: [type:feature, area:admin, area:web, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WRK-009]
epic: EPIC-FACE
---

## Context
`FaceCluster.label` exists ("optional host label, e.g. Bride"). Hosts want to browse "all photos of the bride" and label the main people; this also gives a human check on clustering quality. Must respect suppression and the guest-visibility filter, and must not expose anything to vendors/planners (policy: face features are host/guest only).

## Scope
- Admin (hosts/co-hosts/studio): `/gallery/people` tab listing clusters with ≥ 5 faces ordered by size, each with 6 representative thumbnails (highest `quality` faces, cropped client-side from the thumb using `bbox`), face count, label input (saved to `FaceCluster.label`, audited `cluster.label`), "Merge into…" (sets `clusterId` of all faces to the target and deletes the source — audited; preserved across re-cluster by `_reconcile_clusters` majority rule), and "Hide from People" (sets `suppressed`).
- Guest site: `/gallery/people` shows only labelled, non-suppressed clusters as cards ("Bride", "Groom", "Parents") → clicking lists the photos (visible ones) containing faces of that cluster, paginated via WEB-017's helper.
- No face thumbnails are shown to guests without a label (labels are host-curated and act as consent by the host for those public figures of the event).

## Out of scope
- Automatic naming from guest lists. Showing per-guest "who is in this photo" tags.

## Acceptance criteria
- [ ] Labelling and merging work and are audited (vitest with Postgres); merged cluster ids survive a re-cluster run (pytest extension).
- [ ] Guest People view shows only labelled, non-suppressed clusters and only visible photos (SQL test with a HOSTS_ONLY album).
- [ ] Vendor principal gets 404 on `/gallery/people`.

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/people/{page.tsx,actions.ts}` (new)
- `apps/web/src/app/sites/[slug]/gallery/people/{page.tsx,[clusterId]/page.tsx}` (new), `apps/web/src/lib/gallery.ts`
- `workers/media/hub_worker/handlers/cluster_faces.py`, `workers/media/tests/test_cluster.py`

## Verification
```bash
pnpm --filter @hub/admin test && pnpm --filter @hub/web test
cd workers/media && make test -- -k reconcile
```

## Notes for agents
First failing test: guest People query excludes HOSTS_ONLY photos for a guest. Face crops are rendered from existing thumbs with CSS `object-position`; do not create new derivative files for faces (they would be biometric artefacts to purge).
