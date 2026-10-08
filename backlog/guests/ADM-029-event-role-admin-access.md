---
id: ADM-029
title: Let hosts, planners and vendors open their event's admin pages
labels: [type:feature, area:admin, priority:p1, size:M]
milestone: Phase 1 — MVP
depends_on: [ADM-009]
epic: EPIC-GUESTS
---

## Context
`studios/[studioId]/layout.tsx` and the event layout call `requireAdmin(studioId)`, which demands `studio.view` (studio OWNER or STAFF). Event-role users (HOST, COHOST, PLANNER, VENDOR in `EventMember`) therefore get a 404 on every admin page, even pages whose action `can()` grants them, such as the RSVP report (`rsvp.report`). ADM-009 built the vendor "meal counts only" report view (`reportAccess()` returns `"totals"`, `SubEventCard` hides names) and the export route already serves vendors, but no vendor can reach the page today. docs/02 §4 and docs/04 Phase 1 ("host dashboard") expect hosts, planners and vendors to use these pages.

## Scope
- An event-scoped gate, e.g. `requireEventAccess(studioId, eventId)`, that admits a principal with `studio.view` OR any event role for that event (non-INVITE_LINK session, 12 h re-auth honoured), and 404s everyone else.
- The studio shell for an event-only user shows just their events (no Studio section, no other studios' events).
- `EventTabs` only lists tabs whose action `can()` allows (a vendor sees the RSVP report only).
- Each event page keeps its own `can()` check (report: `reportAccess()`; guests: `guests.manage`; …).

## Out of scope
- New vendor-specific pages or a separate vendor portal.
- Changing the `can()` matrix (ADM-009 added `rsvp.report.names`).

## Acceptance criteria
- [ ] A VENDOR-only user can open `/studios/{s}/events/{e}/guests/report` (200) and sees meal totals without guest names or a "Guest list CSV" link.
- [ ] The same vendor gets 404 for the event's guests list, settings and gallery pages, and for another event in the same studio.
- [ ] A HOST-only user can open the report and sees guest names.
- [ ] Unit tests for the gate function (vitest) covering owner, staff, host, vendor, guest, other-studio and INVITE_LINK principals.

## Files
- `apps/admin/src/lib/auth.ts` (+ `auth.test.ts`)
- `apps/admin/src/app/studios/[studioId]/layout.tsx`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/{layout.tsx,EventTabs.tsx}`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/report/page.tsx`
- Read: `packages/shared/src/policy.ts`, `docs/02-users-and-roles.md` §3-4

## Verification
```bash
pnpm --filter @hub/admin test
# manual: mint a session for an EventMember VENDOR user (see apps/admin/scripts/smoke-session.mts) and curl the report page: 200, no guest names
```

## Notes for agents
Start with the failing gate test for the vendor principal. Keep the decision in `can()`; the gate only asks "may this principal see anything in this event?". Do not let event-role users reach studio-level pages (settings, staff, contacts, pricing).
