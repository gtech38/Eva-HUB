---
id: WEB-040
title: Record BiometricConsent before the selfie reaches the worker
labels: [type:bug, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-FACE
---

## Context
Found while writing the LEG-005 compliance checklist (docs/compliance/biometrics.md, gap G2). `POST /api/face/search` verifies the consent tick and the consent text version before calling the worker, which is right, but it writes the `BiometricConsent` row only in the final transaction, after the selfie has been embedded and matched. If the worker answers `no_face`, is unreachable, or the match query fails, a selfie was processed and no consent row exists. CUBI's rule is consent before capture; the evidence should exist before capture too.

## Scope
- In `apps/web/src/app/api/face/search/route.ts`, create the `BiometricConsent` row (same fields as today) immediately after the subject checks and before the worker call, and carry its id forward. The final transaction stops creating it.
- Keep `AuditLog face.search` in the final transaction (it records the outcome counts) and add `consentId` to its `data`.
- Do not change the FACE_PROFILE consent path (disabled).

## Out of scope
- Revoking a consent row on failure (a consent that was given and used is still a consent).
- `consentLocale` column (DB-005).

## Acceptance criteria
- [ ] Worker returns `no_face`: one `BiometricConsent` row exists for that submission.
- [ ] Worker unreachable (503 `unavailable`): one row exists.
- [ ] Successful search: exactly one row (not two), and the `face.search` audit row references it.
- [ ] A stale or missing consent (`consent_stale`, `consent_required`) still creates no row and never calls the worker.

## Files
`apps/web/src/app/api/face/search/route.ts`, `apps/web/src/app/api/face/search/route.test.ts`

## Verification
```bash
pnpm --filter @hub/web test
node scripts/compliance/verify-purge.mjs <eventId> --database <hub_tN>   # unaffected; run to confirm
```

## Notes for agents
`route.test.ts` already fakes the worker; extend it with a fake that returns `no_face` and one that throws. Assert on `prisma.biometricConsent.count` for the viewer. Update C1 and G2 in `docs/compliance/biometrics.md` when this lands.
