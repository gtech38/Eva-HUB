---
id: EPIC-GUESTS
title: Guests, RSVP, reminders and imports
labels: [type:epic, area:admin, priority:p0, size:L]
milestone: Phase 1 — MVP
---

## Context
Households, guests, per-guest sub-event invites, RSVP, CSV import, invitations and a reminder-rule form exist in `apps/admin`. Gaps against docs/04 Phase 1–2: `FIRE_REMINDER` is enqueued (`saveReminderRule`) but the worker handler only stamps `firedAt` and nothing is sent; there is no bulk household × sub-event editor; RSVP deadlines (`SubEvent.rsvpDeadline`) are stored but not enforced; vendors cannot see meal counts; Google Contacts import is absent.

## Children
- ADM-006 Household editor polish
- ADM-007 Bulk sub-event invite editor
- WRK-002 FIRE_REMINDER selects pending households and queues messages
- ADM-012 Reminder rules and RSVP deadline enforcement
- ADM-009 RSVP report exports and vendor meal counts
- ADM-029 Let hosts, planners and vendors open their event's admin pages
- ADM-010 Google Contacts import
- ADM-011 Google OAuth app verification (external)
- ADM-028 Parse admin date inputs in the event's timezone; startsOn-only events end at local end of day

## Definition of Done
- [ ] A host sets a reminder deadline; at `sendAt` every household with a PENDING invited sub-event receives an SMS (or email when no phone), opted-out numbers excluded, exactly once.
- [ ] After a sub-event's RSVP deadline, guests see a read-only RSVP with a contact-the-host note; hosts can extend.
- [ ] Vendors with `rsvp.report` see only meal counts per sub-event.
- [ ] Guest list can be imported from CSV and Google Contacts with a dry-run preview.
