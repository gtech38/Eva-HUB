---
id: ADM-028
title: Parse admin date inputs in the event's timezone; startsOn-only events end at local end of day
labels: [type:bug, area:admin, area:shared, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [ADM-005]
epic: EPIC-GUESTS
---

## Context
Admin forms send naive local strings (`<input type="date">` for `Event.startsOn`, `datetime-local` for sub-event `startsAt`/`endsAt`/`rsvpDeadline`), and the actions parse them with `new Date("…T00:00:00")` / `new Date(input)`, i.e. in the **server's** timezone, not `Event.timezone`. The schedule page renders them back with the same server-local helpers, so the bug is invisible in dev but shifts every time by the server/event offset in production (UTC server, `America/Chicago` event: 6 h off). ADM-005 computes invite expiry from these instants, and for a `startsOn`-only event the "event end" is local *midnight at the start* of that day rather than the end of it. Found in review of ADM-005 (PR #128).

## Scope
- Pure helpers in `packages/shared` (e.g. `src/zonedTime.ts`): `zonedLocalToUtc("2027-02-14T18:00", "America/Chicago")` and `utcToZonedLocal(date, tz)` for `datetime-local` round-trips, DST-correct, using `Intl` only (no new dependency unless justified).
- `updateEventSettings`, `createEvent`, `saveSubEvent`, `saveReminderRule` parse with the event's timezone; the settings and schedule pages render inputs with the inverse.
- `eventEnd()` in `packages/shared/src/invites.ts`: when only `startsOn` is known, the end is the end of that calendar day in `Event.timezone` (takes `timezone` as an input).

## Out of scope
- Migrating already-stored rows (dev data only so far); note it in the PR if production data exists by then.
- Changing the guest-site display formatting (`apps/web/src/lib/format.ts` already formats with the event timezone).

## Acceptance criteria
- [ ] `zonedLocalToUtc` / `utcToZonedLocal` round-trip across a DST change in `America/Chicago` and for `Asia/Kolkata` (unit tests).
- [ ] Saving a sub-event at 18:00 for an `America/Chicago` event stores 00:00Z next day (CST) regardless of the server's `TZ` (vitest with Postgres, run with `TZ=UTC` and `TZ=Asia/Kolkata`).
- [ ] `eventEnd({ startsOn: 2027-02-14, subEvents: [], timezone: "America/Chicago" })` is 2027-02-15T05:59:59.999Z (end of that local day), and invite expiry is that + 90 d.

## Files
- `packages/shared/src/zonedTime.ts` (new) + test, `packages/shared/src/invites.ts` + test
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `.../invites/actions.ts`, `apps/admin/src/app/studios/[studioId]/events/new/` action
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/{settings,schedule}/page.tsx`, `apps/admin/src/lib/format.ts` (`toLocalInput`, `toDateInput`)

## Verification
```bash
pnpm --filter @hub/shared test
TZ=UTC pnpm --filter @hub/admin test && TZ=Asia/Kolkata pnpm --filter @hub/admin test
pnpm verify
```

## Notes for agents
Write the shared helper tests first; keep the conversion out of the actions (they only call the helper). `Event.startsOn` is a `DateTime`; store the UTC instant of local midnight and derive "end of day" in `eventEnd`, rather than changing the column type.
