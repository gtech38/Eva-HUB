---
id: ADM-003
title: Audit coverage for every mutating action
labels: [type:tech-debt, area:admin, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-TENANCY
---

## Context
docs/01-architecture.md §10: "an AuditLog row for permission changes, visibility changes, exports, consent events and data deletions." Some actions audit (`setPhotoHidden`, retention changes, face search, downloads); others do not (`saveAlbum`, `deleteAlbum`, `movePhoto`, `addMealOption`, `saveRegistryItem`, `saveReminderRule`, `toggleFavorite`, studio settings). Coverage is by memory, not by rule.

## Scope
- Inventory every exported server action in `apps/admin/src/app/**/actions.ts` and `apps/web/src/app/**/actions.ts`; add `audit({...})` with a dotted action name following existing conventions (`album.save`, `album.delete`, `photo.move`, `subevent.save`, `registry.item.save`, `reminder.save`, `studio.settings.update`, `member.add`, `member.remove`, `staff.add`, ...), `target` = primary id, `data` = minimal diff (never secrets or full guest lists).
- Favorites are high-volume and low-value: audit them with `favorite.toggle` only when `AUDIT_FAVORITES=1` (default off) and document why.
- `apps/admin/src/lib/audit.ts`: accept the scoped client/transaction so the audit row is written in the same transaction as the change where one exists.
- Test `apps/admin/src/lib/audit-coverage.test.ts`: statically parse `actions.ts` files (ts-morph or regex on `export async function`) and assert each function body contains `audit(` or is listed in an explicit allowlist (`previewInvite`, `photoStatuses`, `searchStudioContacts`, `beginUpload`).
- Audit page `apps/admin/src/app/platform/audit/page.tsx`: add filters by action prefix and event.

## Out of scope
- Retention/export of the audit log (ADM-023).

## Acceptance criteria
- [ ] The coverage test fails when an action without `audit(` is added and is not allowlisted.
- [ ] Each action listed above writes exactly one `AuditLog` row per successful call (vitest with Postgres for three representative actions).
- [ ] Audit page filters work.

## Files
- `apps/admin/src/app/**/actions.ts`, `apps/web/src/app/sites/[slug]/{gallery,rsvp}/actions.ts`
- `apps/admin/src/lib/audit.ts`, `apps/admin/src/lib/audit-coverage.test.ts` (new), `apps/admin/src/app/platform/audit/page.tsx`

## Verification
```bash
pnpm --filter @hub/admin test
```

## Notes for agents
Write the coverage test first; its failure list is the work list. Never put PII beyond ids in `data`.
