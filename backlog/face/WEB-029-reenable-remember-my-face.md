---
id: WEB-029
title: Re-enable "Remember my face" enrolment once revoke ships
labels: [type:feature, area:web, area:legal, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [WEB-006, WRK-012]
epic: EPIC-FACE
---

## Context
LEG-001 hid the "Remember my face" checkbox and made `/api/face/search` ignore `remember` (`FACE_PROFILE_ENROLMENT = false` in `apps/web/src/lib/faceConsent.ts`) because nobody could withdraw a saved face profile: account-settings revoke (WEB-006, #7) and the 3-year purge (WRK-012, #39) do not exist yet. The v1 `face_profile` consent text therefore promises neither.

## Scope
- New consent version directory (`legal/consent/v2/`) whose `face_profile.*` texts describe the shipped revoke path and purge, per `legal/consent/README.md`; bump `CURRENT_DIR`.
- Set `FACE_PROFILE_ENROLMENT = true`; the page shows the checkbox for adult guests, the client posts `profileConsentVersion`, and the route requires it (already implemented behind the flag).

## Out of scope
- Profile matching/notifications (WRK-010).

## Acceptance criteria
- [ ] With enrolment on, an adult self search with `remember=on` and the current `FACE_PROFILE:<version>` writes a `FACE_PROFILE` consent and a `FaceProfile` row (route test).
- [ ] A missing or stale `profileConsentVersion` returns 409 `consent_stale` without calling the worker (route test).
- [ ] Guardian searches and child viewers never write a `FACE_PROFILE` consent (route test).

## Files
- `apps/web/src/lib/faceConsent.ts` + test, `apps/web/src/app/api/face/search/route.test.ts`, `legal/consent/v2/*`, `packages/shared/src/consent.ts`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
```

## Notes for agents
Flip the flag only after WEB-006's revoke is merged. The v2 texts go through LEG-006 review like v1 (production stays disabled until `reviewed_by` is set).
