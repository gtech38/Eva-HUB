---
id: WEB-041
title: Limit what a face search can be used for beyond the searcher's own face
labels: [type:spike, area:web, area:worker, priority:p1, size:M]
milestone: Phase 1 — MVP
epic: EPIC-FACE
---

## Context
Found in review of the LEG-005 compliance checklist (docs/compliance/biometrics.md, limitation L12, gap G15). Nothing checks that the uploaded "selfie" shows the person searching. `/embed-selfie` returns the largest face in any image (several faces are allowed; the `multiple_faces` reason exists in the web strings but the worker never emits it). Any guest who can search can upload a photo of another adult, or of any child, and locate them in the gallery. For adults that makes "a one-time face search for myself" untrue and means the person never consented. For children it sidesteps the household and `isChild` controls, which decide only which record the results attach to. Real prevention (liveness, identity verification) is a product and counsel decision; some limits are cheap.

## Decision needed before this is agent-ready
Which of these to build, with counsel (LEG-006, question 7 in biometrics.md):
1. Require exactly one face in the upload (the worker already reports `faces`; emit `multiple_faces`). Stops group photos; does not stop a portrait of someone else.
2. Capture from the camera only (`<input capture="user">`) and reject files with no camera EXIF/recent mtime. Weak (easy to bypass) but raises the effort.
3. A per-viewer search quota (for example 5 per event per day) with `face.search.limit` audit rows, so enumeration of many people is visible and slow.
4. A liveness or identity check by a vendor. Heavy; a new processor of biometric data (LEG-003).
5. Accept the residual risk, state it in the consent text and host agreement.

## Scope
Chosen options only, each with tests, plus an update of L12, G15 and the consent texts if the wording changes (a new consent version directory).

## Out of scope
- Invitation-link sessions (SHR-026). Child accounts (SHR-025).

## Acceptance criteria
- [ ] Decision recorded in this file, with the counsel answer if one was needed.
- [ ] For each chosen option, a failing-then-passing test at the route or worker seam.
- [ ] biometrics.md L12 and G15 reflect what is now enforced and what is not.

## Files
`workers/media/hub_worker/api.py`, `apps/web/src/app/api/face/search/route.ts`, `apps/web/src/components/gallery/FaceSearch.tsx`, `apps/web/src/lib/face.ts`, `docs/compliance/biometrics.md`

## Verification
```bash
cd workers/media && make test
pnpm --filter @hub/web test
```

## Notes for agents
Do not claim the control prevents impersonation unless a liveness or identity check is built. Quota and one-face rules reduce, not remove, the risk; say so in the docs.
