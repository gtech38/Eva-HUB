---
id: WRK-021
title: Give every indexed event a face-index purge date, including unpublished ones
labels: [type:bug, area:worker, area:admin, priority:p2, size:S]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-FACE
---

## Context
Found while writing the LEG-005 compliance checklist (docs/compliance/biometrics.md, gap G3). `Event.faceIndexPurgeAt` is computed only when the gallery is published (`galleryPublishedAt + retention`), but `INDEX_FACES` runs as soon as photos are uploaded, usually weeks earlier. Until publication there are embeddings and no purge date, and an event that is never published has them forever. docs/01 §6 says the face index window is "always finite".

## Decision needed before this is agent-ready
What is the anchor for an unpublished event? Proposal: the time of the first indexed photo, with the rule that publishing never moves the date later (`LEAST(existing, publishedAt + window)`). This makes the effective window start at first indexing, which is shorter than the studio expects ("30-730 days after publish"). The alternative, a fixed grace period before publication, is simpler to explain but needs a number from the studio owner and counsel (LEG-006, question C6a in biometrics.md). Choose, then add `agent-ready`.

## Scope
- `INDEX_FACES`: when it writes the first `Face` rows for an event and `faceIndexPurgeAt IS NULL`, set it from the chosen anchor and the effective retention (`COALESCE(event override, studio default)`).
- Admin settings and studio retention changes keep recomputing, never moving an existing date later than the rule allows.
- Event settings shows the date as before; add a note when it was set before publication.

## Out of scope
- The scheduler that acts on the date (WRK-012).

## Acceptance criteria
- [ ] Indexing the first photo of an unpublished event sets `faceIndexPurgeAt`; a second photo does not move it.
- [ ] Publishing the gallery does not move the date later.
- [ ] Changing the retention window recomputes from the same anchor and is audited as today.

## Files
`workers/media/hub_worker/handlers/index_faces.py`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `apps/admin/src/app/studios/[studioId]/actions.ts`, tests beside each, `docs/compliance/biometrics.md`

## Verification
```bash
cd workers/media && .venv/bin/python -m pytest -q tests/ -k index_faces
pnpm --filter @hub/admin test
```

## Notes for agents
Red first with a pure function `purgeAtFor({ publishedAt, firstIndexedAt, retentionDays, existing })`; both the worker and the admin use the same rule, so write it twice only if you also add a cross-check test of the two against the same table of cases.
