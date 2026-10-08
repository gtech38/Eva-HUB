---
id: ADM-012
title: Reminder rules UI and RSVP deadline enforcement
labels: [type:feature, area:admin, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-GUESTS
---

## Context
`saveReminderRule`/`deleteReminderRule` exist in `invites/actions.ts` but the invites page shows little about rule state (fired, how many sent) and the guest site ignores `SubEvent.rsvpDeadline` entirely: `submitRsvp` accepts changes forever. Hosts need the deadline to mean something for catering counts (docs/04 Phase 1 "RSVP flow", decision "SMS reminders when no response arrives by a deadline the host sets").

## Scope
- Admin invites page: rules table with `sendAt`, channel, sub-events, `firedAt`, messages sent (count of `Message(REMINDER)` by rule — add `reminderRuleId String?` to `Message` + migration), and a "Preview recipients" action that runs the WRK-002 selection query read-only and shows counts.
- Deadline enforcement on the guest site: `rsvp/data.ts` marks each invite `locked` when `rsvpDeadline < now()`; `page.tsx` renders locked rows read-only with "The RSVP deadline for X has passed — contact the hosts to change your response"; `submitRsvp` ignores locked rows server-side.
- Host override: event-level setting `allowLateRsvp Boolean @default(false)` on `Event` (+ migration); when true, locked rows stay editable and responses after the deadline are audited `rsvp.late`.
- Hosts and co-hosts editing on behalf of a household (admin guest page) are never blocked by the deadline.

## Out of scope
- Sending (WRK-002/SHR-005).

## Acceptance criteria
- [ ] Unit test for `lockedInvites(invites, now, allowLateRsvp)`.
- [ ] e2e: with a sub-event deadline in the past, the RSVP page shows the locked copy and a POST attempting to change that row leaves the DB unchanged.
- [ ] With `allowLateRsvp` on, the change is saved and `rsvp.late` is audited.
- [ ] Rules table shows `firedAt` and the message count after WRK-002 runs.

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/{page.tsx,actions.ts}`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/settings/page.tsx`
- `apps/web/src/app/sites/[slug]/rsvp/{data.ts,page.tsx,actions.ts}`
- `packages/db/prisma/schema.prisma` + migration `rsvp_deadlines`

## Verification
```bash
pnpm --filter @hub/web test
pnpm e2e --grep deadline
```

## Notes for agents
First failing test: `lockedInvites`. Keep the lock decision in `data.ts` so page and action share it.
