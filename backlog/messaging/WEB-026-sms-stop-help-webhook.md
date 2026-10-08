---
id: WEB-026
title: STOP/HELP inbound SMS webhook → smsOptOut and auto-replies
labels: [type:feature, area:web, area:shared, priority:p1, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-011]
epic: EPIC-MESSAGING
---

## Context
docs/01 §7: "STOP handling: an inbound STOP webhook sets ContactPoint.smsOptOut, and messages are never sent to opted-out numbers." Carriers require STOP/HELP/START handling for 10DLC campaigns (INF-011).

## Scope
- Route `apps/web/src/app/api/sms/[provider]/inbound/route.ts`: vendor signature validation; parse `From`/`Body`; keywords (case-insensitive, trimmed): `STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT` → set `smsOptOut = true` on the matching `ContactPoint` (create an unverified one if none exists so the opt-out sticks to host-typed numbers too: match `Guest.phone` and create `ContactPoint` linked to the guest's user if any, else store in a new `SmsOptOut(phone)` table), reply with the confirmation text; `START|UNSTOP|YES` → clear; `HELP|INFO` → reply with help text including the studio name and support email. Other bodies: log `Message(INBOUND)` (add `MessagePurpose.INBOUND`) for host visibility.
- `sendMessage` (SHR-005) checks both `ContactPoint.smsOptOut` and `SmsOptOut` before sending.
- Admin: Messages view shows inbound STOP events; guest list shows "SMS opted out".
- Tests: each keyword path, signature failure, opt-out enforced on next send.

## Out of scope
- Two-way conversations.

## Acceptance criteria
- [ ] `STOP` from a host-typed number with no `ContactPoint` still prevents the next reminder to that number (vitest with Postgres through `sendMessage`).
- [ ] `HELP` reply body contains the studio name.
- [ ] Invalid signature → 403 and no DB change.

## Files
- `apps/web/src/app/api/sms/[provider]/inbound/route.ts` (new), `packages/shared/src/messaging.ts`, `packages/shared/src/sms/*`, `packages/db/prisma/schema.prisma` (`SmsOptOut`, `MessagePurpose.INBOUND`) + migration
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/page.tsx`

## Verification
```bash
pnpm --filter @hub/web test && pnpm --filter @hub/shared test
```

## Notes for agents
First failing test: STOP on an unverified host-typed number blocks the next send. Reply text must match what was declared in the 10DLC campaign (INF-011).
