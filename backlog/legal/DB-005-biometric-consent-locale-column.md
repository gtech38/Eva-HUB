---
id: DB-005
title: BiometricConsent.consentLocale column
labels: [type:feature, area:db, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [LEG-001]
epic: EPIC-LEGAL
---

## Context
LEG-001 makes the client post the consent text's `KIND:version` and locale; the search route rejects stale submissions and stores `KIND:version` in `BiometricConsent.consentTextVersion`. The **locale** the person read is only recorded in the `face.search` / `consent.grant` AuditLog `data`, so showing "exactly what was consented to" for one consent row needs a join against the audit log.

## Scope
- Migration: `BiometricConsent.consentLocale TEXT NULL` (nullable for rows written before this ticket), with a CHECK that non-null values are one of `en|te|hi`.
- `apps/web/src/app/api/face/search/route.ts`: write `consentLocale` from `checkConsentSubmission()` on both the search consent and the face-profile consent.
- Optional backfill from AuditLog `data.locale` for existing rows.

## Out of scope
- Showing a person their consent history (WEB-006 / LEG-007).

## Acceptance criteria
- [ ] A self search posted with `consentLocale=te` writes `BiometricConsent.consentLocale = 'te'` (route test).
- [ ] The migration applies on a seeded DB and existing rows keep `NULL`.

## Files
- `packages/db/prisma/schema.prisma`, new migration, `apps/web/src/app/api/face/search/route.ts` + `route.test.ts`

## Verification
```bash
pnpm --filter @hub/web test
pnpm --filter @hub/db exec prisma migrate status
```

## Notes for agents
Generate the migration against your own `hub_t<N>` database only. Keep `consentTextVersion` as `KIND:version`; parse it with `parseConsentRecordVersion()` from `@hub/shared/consent`.
