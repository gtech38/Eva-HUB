---
id: SHR-005
title: Internal send endpoint, template renderer and SEND_MESSAGE worker handler
labels: [type:feature, area:shared, area:worker, area:admin, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-MESSAGING
---

## Context
The worker owns scheduling and retries (`FIRE_REMINDER`, zip-ready, face-match notices) but the email/SMS adapters, templates and locales live in TypeScript. `handlers/send_message.py` is a stub. Mirroring adapters in Python would duplicate templates; running a Node consumer adds a third service. Decision: the worker's `SEND_MESSAGE` handler POSTs to an internal endpoint on the admin app that renders and sends with the TS adapters, mirroring how web calls the worker's `/embed-selfie`.

## Scope
- `packages/shared/src/messaging.ts`: `renderMessage(template, locale, data)` returning `{ subject?, text, html?, smsBody? }` from `packages/shared/src/templates/<template>.ts` (en/te/hi; start with `reminder`, `zip_ready`, `face_matches`, `invitation`, `magic_link`, `otp`, `receipt`); `sendMessage(messageId)` loads the `Message` row, resolves data from `payload` (eventId, guestId, zipExportId, count, orderId), refuses when `ContactPoint.smsOptOut` for PHONE or the email is suppressed (SHR-012 hook; stub returns false), calls `email()`/`sms()`, updates `Message.providerId/status/error`, audits `message.sent`.
- Admin route `POST /api/internal/send-message` guarded by `INTERNAL_API_TOKEN` (new env, required in production, defaulted in `.env.example`) and loopback/private-network check; body `{ messageId, template, data }`; returns `{ ok, status }`.
- Worker `send_message.py`: POST with `INTERNAL_API_TOKEN` to `ADMIN_INTERNAL_URL` (new setting); 2xx → succeed; 429/5xx → raise (retry/backoff); 4xx other → mark `Message.status = FAILED` with the error and succeed the job (no retry storm).
- Move inline sends in `invites/actions.ts` and sign-in actions to `Message(QUEUED)` + `SEND_MESSAGE`? No: magic links and OTP must be synchronous for UX; keep those inline but route them through `renderMessage` for consistent templates. Invitations move to the queue (bulk sends should not block the request).
- Tests: vitest for `renderMessage` (all templates × locales produce non-empty text; SMS bodies ≤ 2 segments for en); route test for the token guard; pytest for the handler with a mocked HTTP server (success, 500 → retry, 400 → FAILED).

## Out of scope
- Real providers (SHR-011/012). Template content polish and admin preview (SHR-013).

## Acceptance criteria
- [ ] `POST /api/internal/send-message` without the token → 401; with it and a QUEUED message → `Message.status = SENT` and Mailpit receives the email (integration test).
- [ ] Worker handler: 500 response leaves the job to retry; 400 marks the message FAILED and the job SUCCEEDED (pytest).
- [ ] Sending invitations for 100 guests returns from the server action in under 2 s and queues 100 jobs (vitest with Postgres).
- [ ] Opted-out PHONE contact → `Message.status = SUPPRESSED`, nothing sent.

## Files
- `packages/shared/src/messaging.ts`, `packages/shared/src/templates/*.ts`, `packages/shared/src/messaging.test.ts` (new), `packages/shared/src/env.ts`, `.env.example`
- `apps/admin/src/app/api/internal/send-message/route.ts` (new), `apps/admin/src/app/studios/[studioId]/events/[eventId]/invites/actions.ts`, `apps/admin/src/lib/invites.ts`
- `workers/media/hub_worker/handlers/send_message.py`, `workers/media/hub_worker/config.py`, `workers/media/tests/test_send_message.py` (new)
- `docs/01-architecture.md` §7 (document the internal call), `workers/media/README.md`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
cd workers/media && make test -- -k send_message
```

## Notes for agents
First failing test: token guard 401. The endpoint lives in admin (always deployed, not per-event host-routed). Record the "worker → internal HTTP → TS adapters" decision as an ADR (DOC-010 template).
