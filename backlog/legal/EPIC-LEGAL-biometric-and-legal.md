---
id: EPIC-LEGAL
title: Legal: biometric consent, host agreement, privacy, retention
labels: [type:epic, area:legal, priority:p0, size:L]
milestone: Phase 1 — MVP
---

## Context
Face search indexes every face in a gallery, including people who never opted in; docs/01 §6 names Texas CUBI (consent, no sale, destruction within a year of purpose expiry; $25k per violation) and COPPA for guardian searches as the main legal exposure, and docs/04 lists attorney review as a long-lead item that must finish before launch. The code records consent (`BiometricConsent`, `CONSENT_TEXT_VERSION = "v1-2026-10"` in `apps/web/src/lib/face.ts`) but the consent copy lives only in `gallery/me/page.tsx` strings; there is no host agreement, privacy policy, terms, deletion runbook or retention matrix.

## Children
- LEG-001 Biometric consent text v1 as versioned files wired to the consent UI
- LEG-002 Host agreement draft
- LEG-003 Privacy policy and terms of service drafts
- LEG-005 Biometric compliance checklist (CUBI, COPPA) and data-deletion runbook
- SHR-025 Keep child guests off user accounts and out of self-search
- LEG-007 DSAR / "delete my data" flow spec and data retention matrix
- LEG-006 Texas attorney review (external)
- DB-005 BiometricConsent.consentLocale column

## Definition of Done
- [ ] Consent texts shown in the product are the versioned files, with the version recorded on every `BiometricConsent` row.
- [ ] Host agreement, privacy policy and terms exist as drafts, reviewed by counsel, and are linked from the invitation, sign-in gate and admin signup.
- [ ] The deletion runbook has been executed once against a test event and the audit trail proves the purge.
- [ ] Every data class has a documented retention period and mechanism.
