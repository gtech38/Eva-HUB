---
id: SHR-011
title: SMS provider adapter (Twilio or Telnyx) behind SmsSender
labels: [type:feature, area:shared, priority:p1, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-005]
epic: EPIC-MESSAGING
---

## Context
`sms()` always returns `ConsoleSms`; `SMS_PROVIDER` env only allows `console`. docs/01 §2 lists Twilio/Telnyx as the swappable vendors; 10DLC (INF-011) gates production sending but not implementation against the vendor sandbox.

## Scope
- `packages/shared/src/sms/{twilio,telnyx}.ts` implementing `SmsSender.send` via raw `fetch` to the vendor REST API (no heavy SDK), returning the provider message id; `SMS_PROVIDER=console|twilio|telnyx` plus `SMS_FROM` (number or messaging service sid), `TWILIO_ACCOUNT_SID/AUTH_TOKEN` or `TELNYX_API_KEY`; validated in `env()` only when the provider is selected.
- Delivery status webhook `apps/web/src/app/api/sms/[provider]/status/route.ts` (signature validation per vendor) updating `Message.status` (SENT→DELIVERED/FAILED) by `providerId`; add `@@index([providerId])` on `Message` (docs/03 §3).
- Error mapping: vendor "unsubscribed recipient" errors set `ContactPoint.smsOptOut = true`.
- Tests with recorded fixtures: request body shape, signature verification (valid/invalid), status mapping.

## Out of scope
- Inbound STOP/HELP (WEB-026). Registration (INF-011).

## Acceptance criteria
- [ ] With `SMS_PROVIDER=twilio` and fixture env, `sms().send()` issues the expected POST (nock/msw) and returns the sid.
- [ ] Status webhook with bad signature → 403; valid `delivered` → `Message.status = DELIVERED`.
- [ ] `SMS_PROVIDER=console` behaviour unchanged.

## Files
- `packages/shared/src/sms.ts` → `packages/shared/src/sms/{index,console,twilio,telnyx}.ts`, tests, `packages/shared/src/env.ts`, `.env.example`
- `apps/web/src/app/api/sms/[provider]/status/route.ts` (new), `packages/db/prisma/schema.prisma` (index) + migration

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
```

## Notes for agents
First failing test: signature verification. Pick Twilio as the first implementation unless INF-011 chooses Telnyx; keep both behind the same interface.
