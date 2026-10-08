---
id: LEG-006
title: Texas attorney review of consent texts, host agreement, privacy policy and terms (external)
labels: [type:chore, area:legal, priority:p0, size:S]
milestone: Phase 1 — MVP
depends_on: [LEG-001, LEG-002, LEG-003, LEG-005, LEG-007]
epic: EPIC-LEGAL
---

## Context
docs/04 long-lead items: "Texas attorney review of the biometric consent text, host agreement, privacy policy and terms — Legal turnaround — Before the Phase 1 launch." docs/01 §6: "This is a design input, not a formality."

## Scope
Human checklist:
- [ ] Engage a Texas attorney with biometric privacy (CUBI) and COPPA experience; share `docs/01-architecture.md` §6, `docs/compliance/biometrics.md`, the retention matrix and the drafts under `legal/`.
- [ ] Questions to resolve: is the admin-set 30–730 day window plus "purpose expiry" framing defensible; is the 3-year unused rule for profiles acceptable or must it be 1 year; guardian search under COPPA; whether indexing non-searcher faces needs more than host notice; Telugu/Hindi translations of consent (certified translation?); refund/terms language for prints.
- [ ] Incorporate feedback as new versions (`v2` directories), never edits to `v1`; set `reviewed_by`/`reviewed_on` in front matter.
- [ ] Record the engagement date, firm, and sign-off here; attach the opinion letter location (not in repo).
- [ ] Re-run LEG-001 tests after bumping versions; confirm `BiometricConsent` rows after launch carry the reviewed version.

## Launch dependencies (from LEG-001 review)
The v1 consent texts deliberately describe only what exists today. Before sign-off can enable face search in production (filling `reviewed_by` lifts the production guard), these must ship so the texts can promise them, via a new `v2` version:
- #35 WEB-021 "Remove me from face search" guest control (self-service exclusion from matching; v1 tells people to ask the studio).
- #39 WRK-012 scheduler tick: automatic face-index purges at `faceIndexPurgeAt` and the face-profile 3-year purge (v1 states retention as studio/platform policy only).
- #7 WEB-006 account settings: face-profile revoke and "delete my data" (until then "Remember my face" is hidden and the route ignores `remember`).

## Out of scope
- Any code beyond version bumps handled by the referenced tickets.

## Acceptance criteria
- [ ] Written sign-off obtained before the first LIVE event with face search enabled.

## Files
- `legal/**` (version bumps by follow-up tickets)

## Verification
Sign-off letter on file; `legal/consent/v*/` front matter shows `reviewed_by`.

## Notes for agents
Not agent work.
