---
name: email-sms-adapters
description: Use when sending or tracking email/SMS: packages/shared/src/email.ts (EmailSender, SMTP to Mailpit, console) and sms.ts (SmsSender console, smsSegments), the Message model and statuses, invitation/resend/reminder flows in apps/admin .../invites, InviteToken lifecycle, adding a provider (interface + env switch + webhook status route), and 10DLC/STOP obligations from the docs.
---

# Email and SMS adapters

## When this applies
- Sending any message (magic link, invitation, reminder, receipt).
- Adding Resend/SES/Postmark or Twilio/Telnyx.
- Message status, opt-outs, delivery webhooks.

## Where things live

| Path | What |
|---|---|
| `packages/shared/src/email.ts` | `EmailMessage {to, subject, text, html?}`, `EmailSender` interface, `SmtpSender` (nodemailer, `SMTP_HOST/PORT`, `EMAIL_FROM`), `ConsoleSender`, `email()` singleton chosen by `EMAIL_PROVIDER` (`smtp` | `console`) |
| `packages/shared/src/sms.ts` | `SmsMessage {to, body}`, `SmsSender`, `ConsoleSms` (logs to stdout), `sms()` singleton, `smsSegments()` |
| `packages/shared/src/env.ts` | `EMAIL_PROVIDER` enum, `SMS_PROVIDER` enum (`console` only), SMTP vars, `EMAIL_FROM` |
| `packages/db/prisma/schema.prisma` | `Message` (`studioId`, `eventId?`, `householdId?`, `guestId?`, `channel`, `purpose`, `to`, `locale`, `providerId?`, `status`, `error?`), enums `MessagePurpose` (INVITATION, REMINDER, MAGIC_LINK, OTP, GALLERY_READY, RECEIPT), `MessageStatus` (QUEUED, SENT, DELIVERED, OPENED, CLICKED, BOUNCED, FAILED, SUPPRESSED); `ContactPoint.smsOptOut`; `InviteToken`; `ReminderRule` |
| `apps/admin/src/lib/invites.ts` | `buildMessages(event, guest, link, intro)` -> subject/text/html/smsBody (presentation only) |
| `packages/shared/src/invites.ts` | `eventEnd(event)`, `inviteExpiry(event)` (event end + `INVITE_GRACE_DAYS` 90, or `now + 180d` without dates); admin `lib/inviteTokens.ts` `extendInviteTokens()` re-extends live tokens after date changes (audit `invite.extend`) |
| `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/actions.ts` | `sendInvitations` (channels, scope all/pending, onlyUnsent), `resendInvite` (revokes live tokens, reissues on every channel), `saveReminderRule` (enqueues `FIRE_REMINDER` at `sendAt`, dedupe `reminder:{ruleId}`), `deleteReminderRule`, `previewInvite` |
| `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/page.tsx`, `InviteComposer.tsx` | recipients table with active links / last message, reminder rules |
| `apps/web/src/app/sites/[slug]/auth/actions.ts` | guest magic link by email or SMS; writes `Message MAGIC_LINK` |
| `apps/admin/src/app/login/actions.ts` | admin magic link (email only; no `Message` row) |
| `workers/media/hub_worker/handlers/fire_reminder.py`, `send_message.py` | stubs: reminder stamps `ReminderRule.firedAt`; SEND_MESSAGE logs |
| `apps/admin/scripts/smoke-check-invites.mts` | counts `Message` rows by channel/status, lists tokens and audit rows |

## Conventions in this repo
- **One interface per capability, one env switch.** `email()` / `sms()` return a process-wide singleton; callers never construct senders. Local: `EMAIL_PROVIDER=smtp` -> Mailpit at `localhost:1025`, UI `http://localhost:8025`; `SMS_PROVIDER=console` -> the dev server prints `[sms -> +1...] body`.
- **Every delivery writes a `Message` row** with `providerId` from the adapter and `status: SENT` (or `FAILED` with `error`, or `SUPPRESSED` for opted-out phones). Nothing updates to `DELIVERED`/`OPENED` yet -- that is the webhook's job when a real provider lands.
- **Invitation = personal token per guest per channel.** `InviteToken { tokenHash, guestId, channel, sentTo, expiresAt, revokedAt?, lastUsedAt? }`; link `${eventOrigin(slug)}/i/${token}`; reusable until revoked; "resend" revokes all live tokens for that guest first. Children never receive invitations; adults without email or phone are reached through their household.
- **Opt-out is honoured before sending**: `optOuts()` looks up `ContactPoint.smsOptOut` for the target phones and records `SUPPRESSED` instead of sending.
- **Copy is English-only on the admin side** (`buildMessages`), with the face-search notice included; guest magic-link copy uses `ui()` in the guest's locale. SMS bodies are short: `"{title}: you're invited! Schedule & RSVP: {link}"`.
- **Audit:** `invites.send` (counts), `invite.resend` (per-channel results), `invite.extend` (`{ count, expiresAt }`; `saveSubEvent`/`updateEventSettings` moved the event end later and live tokens were extended), `reminder.create`, `reminder.delete`.
- **Reminders** are host-scheduled `ReminderRule` rows plus a delayed job; actually composing and sending the reminder is not implemented (worker stub). docs/01 §7 describes the intended behaviour: SMS to households with any PENDING invited sub-event, email if no phone.

## Common tasks

### Add an email provider (e.g. Resend)
1. Test first: `packages/shared/src/email.test.ts` (vitest) -- construct `ResendSender` with an injected `fetch` stub, assert the request body (`from`, `to`, `subject`, `text`, `html`) and that `providerId` is taken from the response id. Also assert `email()` returns `ResendSender` when `EMAIL_PROVIDER=resend` (set `process.env` before import; the singleton caches so test in isolation).
2. Implement `class ResendSender implements EmailSender` in `email.ts`; extend the `EMAIL_PROVIDER` enum in `env.ts` with `"resend"` and add `RESEND_API_KEY` to the schema and to `scripts/env-meta.mjs` (`secret: true`), then `pnpm env:docs` regenerates `.env.example`. In production `env()` rejects `EMAIL_PROVIDER=console`.
3. Webhook: `apps/web/src/app/api/webhooks/email/route.ts` (`force-dynamic`, POST, verify the provider signature, map events to `MessageStatus`, `prisma.message.updateMany({ where: { providerId }, data: { status } })`). Test the mapper as a pure function first.
4. Add `WEB_ORIGIN/api/webhooks/email` to the provider dashboard. Keep `smtp` as the local default.

### Add an SMS provider (Twilio/Telnyx)
Same shape: `TwilioSms implements SmsSender`, `SMS_PROVIDER` enum, `TWILIO_*` env, status webhook route, plus an **inbound** webhook that handles `STOP`/`UNSTOP`/`HELP`: set `ContactPoint.smsOptOut` for the E.164 sender (create the contact point unverified if missing) and reply with the required confirmation. Do not ship before 10DLC approval (below). Use `smsSegments()` to log cost per send.

### Send a new message kind (e.g. GALLERY_READY)
1. Test first: pure `buildGalleryReady(event, guest, link)` in `apps/admin/src/lib/` with a vitest test on subject/text (`pnpm --filter @hub/admin test`).
2. In the server action: `authorize(...)`, build copy, `email().send(...)`, `prisma.message.create({ purpose: "GALLERY_READY", ... })`, `audit(...)`.
3. If it should be async/batched, enqueue `SEND_MESSAGE` with the `Message.id` and implement the worker handler (today a stub) -- or keep sending in the action for small batches.

### Inspect what was sent locally
```bash
open http://localhost:8025                                   # Mailpit UI
curl -s 'http://localhost:8025/api/v1/messages?limit=5' | jq '.messages[] | {To, Subject}'
cd apps/admin && pnpm exec tsx scripts/smoke-check-invites.mts
# SMS: look in the `pnpm dev` terminal for lines starting with the phone emoji "[sms -> +1512...]"
```

## Gotchas
- `email()` and `sms()` cache the first sender; changing `EMAIL_PROVIDER` needs a process restart.
- Mailpit accepts any SMTP auth and never bounces; `BOUNCED`/`FAILED` paths are untested locally unless you stub the sender.
- Seed emails lack a TLD (`lakshmi@localhost`); real providers will reject them. Zod `.email()` rejects them too -- use `EmailSchema()` from `apps/admin/src/lib/action.ts`.
- `sendInvitations` loops sequentially and writes one `Message` per channel per guest; 500 guests x 2 channels inside one server action will approach timeouts -- move to `SEND_MESSAGE` jobs before scale.
- `Message.locale` is `event.defaultLocale`, not the recipient's preference (there is no per-guest locale yet).
- Invite tokens are valid until the event end (latest sub-event end, else `startsOn`) + 90 d; expiry is per token, so a resend extends access, and moving the schedule later re-extends live tokens.
- Admin magic links do not create `Message` rows; guest magic links do (`MAGIC_LINK`).
- The console SMS/email senders print with an emoji prefix in server logs (`sms.ts`, `email.ts`); fine for logs, but UI copy must stay emoji-free.

## Compliance obligations (from docs/01 §7, docs/04 §2)
- **US A2P 10DLC** brand + campaign registration (or toll-free verification) before any application SMS from a 10-digit number; vetting takes days to weeks. Start early; `SMS_PROVIDER=console` until approved.
- **STOP/HELP handling** is mandatory: inbound STOP sets `ContactPoint.smsOptOut`; never send to opted-out numbers (already enforced for invitations).
- **Telugu/Hindi SMS are UCS-2** (70/67 chars per segment): keep bodies short and link to the localized page.
- **Email domain authentication** (SPF, DKIM, DMARC) on the sending domain before launch; warm up reputation.

## Verification
```bash
pnpm --filter @hub/shared test
pnpm typecheck
# send an invitation from admin, then:
curl -s 'http://localhost:8025/api/v1/search?query=subject:"You%27re%20invited"' | jq '.messages_count'
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT channel,purpose,status,count(*) FROM "Message" GROUP BY 1,2,3;'
```

## References
- `docs/01-architecture.md` §7 Messaging; §2 adapter rule
- `docs/02-users-and-roles.md` §2 (invitation rules: every adult, every channel; reuse; rotation on resend)
- `docs/04-plan.md` §2 long-lead items (10DLC, SPF/DKIM)
- Nodemailer: https://nodemailer.com/; Mailpit API: https://mailpit.axllent.org/docs/api-v1/
- Related skills: `auth-sessions-policy`, `i18n-localized-content`, `docker-local-infra`, `admin-app-patterns`
