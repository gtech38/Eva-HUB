---
id: ADM-009
title: RSVP report exports per sub-event and vendor meal counts
labels: [type:feature, area:admin, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-GUESTS
---

## Context
`guests/report/page.tsx` and `report/export/route.ts` produce one wide CSV. docs/02 §4 gives vendors "meal counts only" and planners/hosts full reports; docs/04 Phase 1 host dashboard: "headcount per sub-event, meal counts, CSV export". Caterers want one sheet per sub-event with meal totals and dietary notes.

## Scope
- Report page: per sub-event cards with attending/declined/pending, meal option totals (adults vs kids meals via `MealOption.isKidsMeal`), and a per-sub-event CSV link `export?subEventId=...` (columns: household, guest, is_child, status, meal).
- Vendor view: when `can(p, "rsvp.report")` is true only via the `VENDOR` role, render meal totals only (no names), and the export route refuses name-level exports (403) for vendors.
- Add `@@index([subEventId, status])` on `Rsvp` (docs/03 §3) with a migration.
- Export audit (`rsvp.export`) records `subEventId` and vendor flag.

## Out of scope
- Seating, dietary free-text fields (not modelled).

## Acceptance criteria
- [ ] Unit test for `mealTotals(rsvps)` grouping adults/kids per option.
- [ ] A VENDOR principal gets 403 from `export` without `subEventId` and from the names CSV, and 200 for `export?subEventId=...&totals=1`.
- [ ] Host sees names; vendor sees only totals (vitest render test or e2e).

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/report/{page.tsx,export/route.ts}`, `apps/admin/src/lib/guests.ts`
- `packages/db/prisma/schema.prisma` + migration `rsvp_index`
- Read: `packages/shared/src/policy.ts` (`rsvp.report` includes VENDOR)

## Verification
```bash
pnpm --filter @hub/admin test
```

## Notes for agents
First failing test: vendor 403 on the names export. The policy returns true for vendors on `rsvp.report`; the "limited" cell is enforced here, not in `can()`. Consider adding `rsvp.report.names` to `Action` if cleaner, with a policy test.
