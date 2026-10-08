# ADR-0008: Worker sends messages through an internal admin HTTP endpoint

- Status: Proposed
- Date: 2026-10-08
- Tickets: SHR-005, SHR-011, SHR-012, SHR-013

## Context

The worker owns scheduling and retries for reminders, zip-ready and face-match notices (`SEND_MESSAGE`, `FIRE_REMINDER`). The email and SMS adapters, templates and locales (en, te, hi) live in TypeScript. `workers/media/hub_worker/handlers/send_message.py` is currently a stub that logs and succeeds.

## Decision

Proposed, to be accepted when SHR-005 merges. The `SEND_MESSAGE` handler POSTs `{messageId, template, data}` to an internal admin route, `POST /api/internal/send-message`, which renders the template and sends through the existing `email()` and `sms()` adapters, then updates the `Message` row. The call is authenticated with a shared `INTERNAL_API_TOKEN` and restricted to the private network; the worker reaches it at `ADMIN_INTERNAL_URL`. Result mapping: 2xx succeeds the job; 429 and 5xx raise so the job retries with backoff (ADR-0001); other 4xx marks the `Message` `FAILED` and succeeds the job so there is no retry storm. Magic links and OTP stay synchronous in the web and admin apps; invitations move to the queue. This mirrors how web already calls the worker's `/embed-selfie`.

## Consequences

- Templates, locales and adapters exist once, in `packages/shared`; the worker gains no Node or SMS code.
- The worker depends on the admin app being up, and the admin gains a machine-facing route that needs the token guard and tests. This is why the endpoint is in admin (ADR-0007), which is always deployed, rather than in a per-host web app.
- Follow-ups: real providers and delivery webhooks (SHR-011, SHR-012), template content and preview (SHR-013); docs/01 section 7 and the worker README document the internal call.
- If the decision changes before the ticket merges, edit this ADR; afterwards supersede it.

## Alternatives

- Mirror the adapters and templates in Python: duplicates templates and locales and drifts from the TypeScript side.
- A Node job consumer for `SEND_MESSAGE`: adds a third runtime service to deploy.
- Send inline from the request that causes it: blocks bulk invitation requests and loses retry and scheduling.

## References

- `workers/media/hub_worker/handlers/send_message.py`
- `apps/web/src/app/api/face/search/route.ts`
- `packages/shared/src/email.ts`
- `packages/shared/src/sms.ts`
- `backlog/messaging/SHR-005-internal-send-endpoint-and-handler.md`
