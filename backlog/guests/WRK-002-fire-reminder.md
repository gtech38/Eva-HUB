---
id: WRK-002
title: FIRE_REMINDER selects pending households and queues reminder messages
labels: [type:feature, area:worker, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [SHR-005]
epic: EPIC-GUESTS
---

## Context
`saveReminderRule` enqueues `FIRE_REMINDER {reminderRuleId, eventId}` with `runAt = sendAt` and `dedupeKey reminder:<id>`. The handler `workers/media/hub_worker/handlers/fire_reminder.py` only sets `firedAt`; nobody is reminded. docs/01 §7: "At sendAt, a job finds households that are still pending for the relevant sub-events and sends them an SMS, or email if they have no phone number."

## Scope
- Rewrite `fire_reminder.py`:
  1. Load the rule; exit if `firedAt` is set (idempotent) or the event is not `LIVE`.
  2. Select households with at least one guest (`deletedAt IS NULL`, `isChild = false` not required for the household test) whose `Rsvp.status = 'PENDING'` for a sub-event in `rule.subEventIds` (empty = all) where `SubEvent.rsvpDeadline IS NULL OR rsvpDeadline >= now()`.
  3. For each household pick recipients: every adult guest with a phone (`channel PHONE`) unless the matching `ContactPoint.smsOptOut` is true or the rule channel is EMAIL; adults with no phone but an email get EMAIL. No contact → skip and count.
  4. Insert `Message(purpose: REMINDER, status: QUEUED, channel, to, locale = event.defaultLocale, householdId, guestId, eventId, studioId)` and enqueue `SEND_MESSAGE {messageId, template: "reminder", eventId}` with `dedupe_key = f"msg:{messageId}"` in one transaction; then set `firedAt`.
  5. `AuditLog reminder.fire` with counts (households, messages, skippedOptOut, skippedNoContact).
- `Requeue` if the event's invitations were never sent (no `Message(INVITATION)` rows) — log and mark fired with zero sends instead of spamming.
- Tests in `workers/media/tests/test_fire_reminder.py` using the real Postgres and fixture rows: pending household gets one SMS message; responded household gets none; opted-out phone falls back to email; second run is a no-op.

## Out of scope
- Rendering and sending the message (SHR-005). Reminder editor UI (ADM-012).

## Acceptance criteria
- [ ] Given 3 households (pending-with-phone, pending-opted-out-with-email, all-responded), the handler creates exactly 2 `Message` rows (PHONE, EMAIL) and 2 `SEND_MESSAGE` jobs.
- [ ] Running the handler twice creates no additional rows.
- [ ] Sub-events past their `rsvpDeadline` do not trigger reminders.
- [ ] `AuditLog` row has the four counts.

## Files
- `workers/media/hub_worker/handlers/fire_reminder.py`, `workers/media/tests/test_fire_reminder.py` (new)
- Read: `workers/media/hub_worker/jobs.py` (`enqueue`, `Requeue`), `packages/db/prisma/schema.prisma` (ReminderRule, Message, Rsvp, ContactPoint)

## Verification
```bash
cd workers/media && make test -- -k fire_reminder
```

## Notes for agents
Write the three-household test first. Opt-out lives on `ContactPoint` (verified contacts), while `Guest.phone` is host-typed; join on `ContactPoint.value = Guest.phone AND kind = 'PHONE'` for the opt-out check, and still send to unverified host-typed numbers (that is how first contact happens).
