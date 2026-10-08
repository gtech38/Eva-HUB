---
id: ADM-006
title: Household editor polish: inline members, plus-ones, kids, gallery-only, tags
labels: [type:feature, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-GUESTS
---

## Context
`apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/page.tsx` lists households and guests with basic forms. Hosts need to do the real work here: add a household in one go with members, mark kids and plus-one slots, set `galleryOnly`, side and tags, and see link status (which members have a verified user). docs/03 §2 decisions 3–5.

## Scope
- Household card: inline-editable name, side, `plusOnesAllowed`, tags (chips), host-private notes; member rows with first/last, email, phone, `isChild`, `isPrimaryContact`, `galleryOnly`, "linked" badge (`userId` set), invite status (tokens sent/used), RSVP summary per sub-event.
- "Add household" drawer: name + N members in one submit (`createHouseholdWithMembers` action, zod-validated, transaction); `plusOnesAllowed` creates placeholder `Guest(isPlusOne)` rows and their `SubEventInvite`/`Rsvp(PENDING)` rows for the household's default sub-events.
- Search/filter: by name, side, tag, RSVP status, unlinked, no-contact.
- Soft delete member (`deletedAt`) and household (cascade soft delete, refuse if any RSVP responded unless `force`).
- Server actions in `guests/actions.ts`; every mutation audited (ADM-003 naming).

## Out of scope
- Bulk invite matrix (ADM-007). Import (exists; Google in ADM-010).

## Acceptance criteria
- [ ] Creating a household with 2 adults, 1 child, `plusOnesAllowed: 1` yields 4 guest rows, the plus-one flagged, and PENDING RSVPs for each invited sub-event (vitest with Postgres).
- [ ] Filter "unlinked" shows only guests with `userId = null`.
- [ ] Deleting a household with a responded RSVP returns an error state unless `force`.
- [ ] e2e: host adds a household from the drawer and sees it in the list.

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/{page.tsx,actions.ts}`, new components under `guests/components/`
- `apps/admin/src/lib/guests.ts`
- Read: `packages/db/prisma/schema.prisma` (Household, Guest, SubEventInvite, Rsvp)

## Verification
```bash
pnpm --filter @hub/admin test
pnpm e2e --grep household
```

## Notes for agents
First failing test: `createHouseholdWithMembers` row counts. Keep the pure "which rows to create" logic in `lib/guests.ts` so it is unit-testable without React.
