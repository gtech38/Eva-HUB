---
id: EPIC-MESSAGING
title: Messaging: SMS and email providers, templates, deliverability
labels: [type:epic, area:shared, priority:p1, size:L]
milestone: Phase 2 — Commerce, messaging, polish
---

## Context
`packages/shared/src/{email,sms}.ts` define `EmailSender`/`SmsSender` with SMTP (Mailpit) and console implementations. Invitations and magic links are sent inline from server actions; `Message` rows are written with `status: SENT` and never updated; `SEND_MESSAGE` in the worker is a stub; there is no SMS provider, no STOP handling, no templates per locale beyond `buildMessages` in admin, and no deliverability setup. docs/01 §7 defines the target; 10DLC registration is a long-lead item.

## Children
- SHR-005 Internal send endpoint, template renderer and `SEND_MESSAGE` worker handler
- SHR-013 Message templates per locale with UCS-2 awareness, preview and test-send
- SHR-011 SMS provider adapter (Twilio/Telnyx) behind `SmsSender`
- INF-011 A2P 10DLC brand and campaign registration (external)
- WEB-026 STOP/HELP inbound SMS webhook → `smsOptOut`
- SHR-012 Email provider adapter with delivery/bounce webhooks and suppression list
- DOC-002 SPF, DKIM and DMARC setup for the sending domain

## Definition of Done
- [ ] Every outbound message is a `Message` row whose status moves QUEUED → SENT → DELIVERED/BOUNCED from provider webhooks.
- [ ] Reminders and notices go out through the worker queue with retries, not from request handlers.
- [ ] Opted-out numbers and suppressed emails are never sent to, with tests.
- [ ] Templates exist in en/te/hi for every `MessagePurpose`, with SMS segment counts shown in the admin preview.
