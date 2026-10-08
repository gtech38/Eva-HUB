---
id: LEG-001
title: Biometric consent text v1 (searcher, guardian, face profile) as versioned files wired to the UI
labels: [type:feature, area:legal, area:web, priority:p0, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-LEGAL
---

## Context
`BiometricConsent.consentTextVersion` stores `CONSENT_TEXT_VERSION` from `apps/web/src/lib/face.ts`, but the words the user saw are the `S.consentLabel/consentDetail/rememberDetail` strings in `gallery/me/page.tsx`, which can change without the version changing. For CUBI the platform must be able to show exactly what was consented to, per version, per locale, for each of the three consent kinds.

## Scope
- `legal/consent/v1/{search_self,search_guardian,face_profile}.{en,te,hi}.md`: plain-language texts covering what is collected (face geometry from the selfie / the child's selfie / stored signature), purpose, that the selfie is never stored, retention (event index purge window set by the studio; profile 3 years unused), no sale, how to withdraw (remove-me control WEB-021, account settings WEB-006), and for the guardian text the parent/guardian attestation. Front matter: `version: v1-2026-10`, `effective`, `kind`, `locale`, `reviewed_by` (empty until LEG-006).
- Loader `packages/shared/src/consent.ts`: `consentText(kind, locale)` reads the bundled markdown at build time (import as raw) and exports `CONSENT_TEXT_VERSION` derived from the files' front matter (single source; delete the constant in `apps/web/src/lib/face.ts`).
- UI: `FaceSearch.tsx` renders the full text in an expandable "What you're agreeing to" with the summary label; the `consentTextVersion` written by `/api/face/search` comes from the loader and distinguishes `SEARCH_SELF` vs `SEARCH_GUARDIAN` vs `FACE_PROFILE` texts (store `kind:version`).
- Admin: `/platform/legal` page listing the current consent versions and texts (read-only).
- Test: every kind × locale file exists, has front matter with the same version, and is non-empty; the search route writes the loader's version.

## Out of scope
- Legal correctness (LEG-006 reviews). Host agreement (LEG-002).

## Acceptance criteria
- [ ] Nine consent files exist with matching `version`; the unit test fails if one is missing or versions diverge.
- [ ] `BiometricConsent.consentTextVersion` for a self search equals `SEARCH_SELF:v1-2026-10` (vitest route test).
- [ ] The full text is reachable from the consent checkbox in all three locales (e2e).

## Files
- `legal/consent/v1/*.md` (new), `packages/shared/src/consent.ts` + test (new), `apps/web/src/lib/face.ts`, `apps/web/src/components/gallery/FaceSearch.tsx`, `apps/web/src/app/sites/[slug]/gallery/me/page.tsx`, `apps/web/src/app/api/face/search/route.ts`, `apps/admin/src/app/platform/legal/page.tsx` (new)

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
pnpm e2e --grep consent
```

## Notes for agents
First failing test: files × version consistency. Changing any text requires a new `v2` directory, never editing `v1` (write that rule into `legal/consent/README.md`).
