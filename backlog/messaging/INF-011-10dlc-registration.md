---
id: INF-011
title: A2P 10DLC brand and campaign registration (external)
labels: [type:chore, area:infra, area:legal, priority:p1, size:S]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [INF-019, LEG-003]
epic: EPIC-MESSAGING
---

## Context
docs/01 §7: "US A2P 10DLC registration is mandatory before sending application SMS from a 10-digit number. Brand and campaign vetting takes days to weeks." docs/04 long-lead items. Human steps.

## Scope
Human checklist:
- [ ] Choose vendor (Twilio or Telnyx) — record in this ticket and in `docs/adr/`.
- [ ] Register the brand (legal entity, EIN, website on the studio domain).
- [ ] Register the campaign: use case "Account notifications / Event RSVP invitations and reminders"; sample messages from SHR-013 templates (en); opt-in description (host-provided guest list, invitation includes STOP); STOP/HELP keywords; message volume estimate.
- [ ] Buy the long code (or messaging service) and attach to the campaign; alternatively start toll-free verification as a fallback.
- [ ] Configure inbound webhook URL (WEB-026) and status callback (SHR-011) in the vendor console.
- [ ] Record approval date, campaign id, throughput limits here; set `SMS_PROVIDER`, `SMS_FROM` and credentials in production secrets (DOC-005).

## Out of scope
- Code.

## Acceptance criteria
- [ ] Campaign approved; a production test message is delivered to the studio owner's phone and shows DELIVERED in the admin Messages view.

## Files
- none

## Verification
Vendor console shows the campaign as approved.

## Notes for agents
Not agent work.
