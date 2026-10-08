---
id: ADM-010
title: Google Contacts import via People API with mapping and dry run
labels: [type:feature, area:admin, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [ADM-011]
epic: EPIC-GUESTS
---

## Context
README decision "Import: CSV and Google Contacts"; docs/04 Phase 2 "Google Contacts import: People API, with an OAuth app that has passed verification". The CSV wizard (`guests/import/ImportWizard.tsx`) already has mapping and dry-run; this reuses it with a second source.

## Scope
- OAuth: `GOOGLE_CLIENT_ID/SECRET` in `env()` (optional; feature hidden when unset); `/studios/[studioId]/events/[eventId]/guests/import/google/start` redirects with scope `contacts.readonly`, state bound to the session; callback exchanges the code server-side, stores the access token in the session only (never persisted), fetches `people.connections.list` with `personFields=names,emailAddresses,phoneNumbers` and groups (`contactGroups`).
- Mapping step reuses `ImportWizard`: pick contact groups/labels, map to household (one contact = one household of one adult by default; "same last name + shared address → one household" toggle), preview dry run with duplicates against existing guests (email/phone match) flagged.
- Import writes `Household.importSource = "google"`; audited `guests.import` with counts.
- Tests mock the People API with recorded JSON fixtures.

## Out of scope
- Writing back to Google. Calendar.

## Acceptance criteria
- [ ] With fixture JSON of 5 contacts (2 sharing a surname+address), the household grouping toggle yields 5 vs 4 households (unit test on the pure grouping function).
- [ ] Duplicate detection flags a contact whose email matches an existing guest and does not create a second row on import.
- [ ] Feature is invisible when `GOOGLE_CLIENT_ID` is unset.
- [ ] Access token is never written to the DB or logs (grep test over log output in the vitest).

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/import/google/{start,callback}/route.ts`, `ImportWizard.tsx`, `apps/admin/src/lib/google-people.ts` (new), `apps/admin/src/lib/guests.ts`
- `packages/shared/src/env.ts`

## Verification
```bash
pnpm --filter @hub/admin test
```

## Notes for agents
First failing test: grouping function. Keep Google HTTP in one module behind an interface so fixtures can replace it. The OAuth app verification (ADM-011) blocks only production use, not development with test users.
