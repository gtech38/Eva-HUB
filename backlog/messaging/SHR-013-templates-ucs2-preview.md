---
id: SHR-013
title: Message templates per locale with UCS-2 segment awareness, preview and test-send
labels: [type:feature, area:shared, area:admin, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-005]
epic: EPIC-MESSAGING
---

## Context
docs/01 §7: "Telugu and Hindi SMS use UCS-2 encoding, 70 characters per segment instead of 160. Keep SMS bodies short and send a link to the localized page." `smsSegments()` exists. Hosts should see what will be sent, in each locale, with cost implications, and be able to send a test to themselves.

## Scope
- Template registry (`packages/shared/src/templates/index.ts`): typed data per template, `en/te/hi` variants, host-editable intro per event (`EventPage`-like `MessageTemplateOverride(eventId, template, locale, intro)` table + migration) merged into the rendered output.
- SMS bodies: short-link to the localized page (`/r/<token>` resolver that redirects to the deep link and records a click → `Message.status = CLICKED`); hard cap 2 segments; `renderMessage` returns `{ segments, encoding }`.
- Admin invites page "Preview" panel: pick template + locale + sample household → rendered email HTML (iframe sandbox), SMS body with `N segments (UCS-2)` badge and estimated cost (`SMS_SEGMENT_COST_CENTS` env); "Send test to me" → sends to the signed-in admin's verified email/phone through the normal queue flagged `test: true` (never to guests).
- Unsubscribe footer for marketing-ish emails (invitations/reminders) with a `/u/<token>` link setting `ContactPoint.smsOptOut`-equivalent `emailOptOut` (add column) — transactional (OTP, receipts) excluded.
- Tests: every template × locale renders; te/hi SMS ≤ 2 segments; short link redirect + click tracking; test-send never targets a guest.

## Out of scope
- Rich email designer. Provider adapters.

## Acceptance criteria
- [ ] Rendering `reminder` in `te` yields ≤ 134 UCS-2 chars (2 segments) with the short link (unit test).
- [ ] Preview shows the segment badge and updates when the host edits the intro (e2e).
- [ ] Test-send with a guest's address in the form is refused (vitest).
- [ ] `/u/<token>` sets `emailOptOut` and subsequent `sendMessage` for a REMINDER marks SUPPRESSED.

## Files
- `packages/shared/src/templates/*`, `packages/shared/src/messaging.ts`, `packages/shared/src/sms.ts`, tests
- `apps/web/src/app/{r,u}/[token]/route.ts` (new; root-domain routes, update middleware), `packages/db/prisma/schema.prisma` + migration
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/{page.tsx,InviteComposer.tsx,actions.ts}`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
pnpm e2e --grep preview
```

## Notes for agents
First failing test: te reminder segment cap. Short-link tokens are random, single-purpose and expire with the event; they must not be guessable from message ids.
