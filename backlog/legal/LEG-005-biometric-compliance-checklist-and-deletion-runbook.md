---
id: LEG-005
title: Biometric compliance checklist (Texas CUBI, COPPA) and data-deletion runbook
labels: [type:chore, area:legal, area:docs, area:worker, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-LEGAL
---

## Context
docs/01 §6 sets out the CUBI position (informed consent, no sale, bounded retention 30–730 days, purge job, remove-me control, per-event switch) and flags COPPA for guardian searches ("the information comes from a consenting parent, not from the child directly"). The platform must be able to **prove** a purge happened: `PURGE_FACE_INDEX` writes `AuditLog faceindex.purge` with counts, and `PhotoMatch` intentionally survives.

## Scope
- `docs/compliance/biometrics.md`: requirement → control → evidence table for CUBI §503.001 (consent before capture → LEG-001 + `BiometricConsent` row; no sale/disclosure → policy + processor list; reasonable care → encryption at rest/in transit, RLS; destruction within 1 year of purpose expiry → `faceIndexPurgeAt` bounded to ≤ 730 days with the argument for "purpose" definition, profile 3-year unused rule → `[COUNSEL]` note on whether 3 years is defensible or must be 1 year after last use), and COPPA notes (guardian attestation text, no child accounts, no profile for minors, data minimisation: child matches stored as `PhotoMatch(subjectGuestId)` only, deletion on guardian request).
- Known limitations stated plainly: non-searcher faces are indexed; cluster suppression is best-effort; "remove me" cannot remove the person from other people's photos.
- `docs/compliance/runbook-biometric-deletion.md`: (1) per event: trigger purge (admin `purgeFaceIndexNow` or wait for WRK-012), verify with SQL (`SELECT count(*) FROM "Face" WHERE "eventId"=...` = 0, same for `FaceCluster`), locate the `faceindex.purge` audit row, export it (ADM-023), confirm `Event.faceIndexPurgedAt`; (2) per person: `faceSearchOptOut`, `FaceProfile` delete + consent revoke (WEB-006/WEB-021), `PhotoMatch` deletion on request (DSAR, LEG-007), audit rows; (3) backups: note that backups (DOC-003) retain embeddings until expiry — document the retention of backups as part of the destruction timeline.
- Script `scripts/compliance/verify-purge.mjs <eventId>` printing the checks above as PASS/FAIL (used in the runbook and by a vitest against a purged fixture event).

## Out of scope
- Changing retention defaults (admin-set already). Legal conclusions (LEG-006).

## Acceptance criteria
- [ ] `verify-purge.mjs` reports PASS for an event after `PURGE_FACE_INDEX` ran and FAIL for an un-purged event (vitest with Postgres; run the Python handler via `make test` fixture or replicate its SQL in the test setup).
- [ ] Checklist table has an evidence pointer (file/table/audit action) for every requirement row.
- [ ] Runbook executed once on the seed event; output pasted into the PR.

## Files
- `docs/compliance/{biometrics.md,runbook-biometric-deletion.md}`, `scripts/compliance/verify-purge.mjs` + test (new)

## Verification
```bash
node scripts/compliance/verify-purge.mjs <eventId>
pnpm test
```

## Notes for agents
First failing test: verify-purge FAIL/PASS. Do not soften the known-limitations section; counsel needs the real picture.
