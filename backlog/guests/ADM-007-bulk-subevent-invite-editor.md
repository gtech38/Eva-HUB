---
id: ADM-007
title: Bulk sub-event invite editor (household × sub-event matrix with per-member override)
labels: [type:feature, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [ADM-006]
epic: EPIC-GUESTS
---

## Context
docs/03 §2.3: "Invitations to sub-events are per guest, not per household... The host UI works at household level with a per-member override, and writes SubEventInvite rows for each guest." Today invites are edited guest by guest.

## Scope
- `/guests/invites-matrix` page: rows = households (expandable to members), columns = sub-events; a household cell is a tri-state checkbox (all / some / none); expanding shows per-member checkboxes. Bulk tools: "invite all adults to X", "invite everyone to Y", "kids not invited to Z", filter by side/tag.
- Save computes a diff and applies it in one transaction: create missing `SubEventInvite` + `Rsvp(PENDING)`; remove invites only where the `Rsvp` is still PENDING (responded ones are kept and flagged "responded, un-invite blocked" in the UI).
- Shows headcount impact before save ("+42 invites, -3").
- Audit `invites.matrix.apply` with counts.

## Out of scope
- Sending invitations (exists). Seating.

## Acceptance criteria
- [ ] Pure function `diffInvites(current, desired)` unit-tested: adds, removes-only-pending, no-op.
- [ ] Applying a matrix for 50 households × 4 sub-events completes in one transaction under 2 s on the seed DB (vitest timing assertion generous: < 5 s).
- [ ] Removing an invite with a responded RSVP is refused and reported, not silently skipped.
- [ ] e2e: toggle a household cell, save, reload, state persists.

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/invites-matrix/{page.tsx,Matrix.tsx,actions.ts}` (new)
- `apps/admin/src/lib/guests.ts` (`diffInvites`), `apps/admin/src/lib/guests.test.ts`

## Verification
```bash
pnpm --filter @hub/admin test
pnpm e2e --grep matrix
```

## Notes for agents
Start with `diffInvites` tests. The matrix is a client component; keep server actions thin and validated with zod arrays of `{guestId, subEventId, invited}`.
