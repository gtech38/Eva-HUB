---
id: WEB-021
title: '"Remove me from face search" guest control'
labels: [type:feature, area:web, priority:p0, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-FACE
---

## Context
docs/01 §6 mitigation: "A 'remove me from face search' control deletes the guest's cluster and suppresses re-indexing." The invitation email already promises "you can opt out from the gallery at any time". The schema has `Guest.faceSearchOptOut` and `FaceCluster.suppressed` and the search SQL respects both, but no UI sets them and no cluster is ever suppressed.

## Scope
- On `/gallery/me`: "Remove me from face search" (and, for household adults, per child "Remove <child> from face search"). Confirmation explains the effect: your face will no longer be matched, existing matches for you are deleted, photos themselves stay in the gallery.
- Server action `optOutFaceSearch(subject: "me" | guestId)`: sets `Guest.faceSearchOptOut = true`; deletes `PhotoMatch` rows for the subject (`userId` or `subjectGuestId`); if the subject has a `FaceProfile`, deletes it and revokes its consent; identifies clusters to suppress = clusters of faces in photos matched to the subject whose top-score face is that subject (best effort: clusters containing the faces that produced the matches — requires storing `faceId` on `PhotoMatch`; add `faceId String?` + migration and set it in the search route and `_match_profiles`); sets `FaceCluster.suppressed = true` for those; audits `face.optout` with the counts (no biometric data).
- Worker: `_reconcile_clusters` already preserves `suppressed`; add a pytest that a suppressed cluster stays suppressed after re-clustering with new faces (exists partially; make explicit).
- Undo: "Allow face search again" clears the flag only (clusters stay suppressed until a studio re-index; explain).
- Studio admin guest list shows the opt-out badge.

## Out of scope
- Removing the person's faces from other guests' results beyond cluster suppression (inherent limit; document in LEG-005).

## Acceptance criteria
- [ ] After opt-out, `POST /api/face/search` for that guest returns `opted_out`, their `PhotoMatch` rows are gone, and their `FaceProfile` (if any) is deleted (vitest with Postgres).
- [ ] Clusters linked via `PhotoMatch.faceId` are `suppressed` and excluded from another guest's search results for those faces (SQL-level test).
- [ ] Re-clustering keeps `suppressed` (pytest).
- [ ] e2e: guest clicks remove, confirmation, page shows the opted-out state.

## Files
- `apps/web/src/app/sites/[slug]/gallery/me/{page.tsx,actions.ts}` (new actions file), `apps/web/src/components/gallery/FaceSearch.tsx`, `apps/web/src/app/api/face/search/route.ts`
- `packages/db/prisma/schema.prisma` (`PhotoMatch.faceId`) + migration
- `workers/media/hub_worker/handlers/cluster_faces.py`, `workers/media/tests/test_cluster.py`

## Verification
```bash
pnpm --filter @hub/web test
cd workers/media && make test -- -k suppressed
pnpm e2e --grep "remove me"
```

## Notes for agents
First failing test: opt-out deletes matches and the search returns `opted_out`. `faceId` on `PhotoMatch` is a plain id reference, not biometric; keep `onDelete: SetNull` so purges do not cascade into matches.
