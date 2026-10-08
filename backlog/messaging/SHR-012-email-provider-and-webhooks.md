---
id: SHR-012
title: Email provider adapter (Resend/SES/Postmark) with delivery, bounce and open webhooks and a suppression list
labels: [type:feature, area:shared, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-005]
epic: EPIC-MESSAGING
---

## Context
docs/01 §7: "Email: the adapter records the provider message ID. Delivery, bounce, open and click events arrive by webhook and update Message.status." Only SMTP→Mailpit exists. Hard bounces must stop future sends (sender reputation, DOC-002).

## Scope
- `packages/shared/src/email/{resend,ses,postmark}.ts` behind `EmailSender` (implement one fully — Resend via `fetch` — and leave SES/Postmark as thin stubs that throw `NotConfigured` with the mapping documented); `EMAIL_PROVIDER=console|smtp|resend` and credentials validated when selected; `List-Unsubscribe` headers for invitation/reminder emails (link from SHR-013).
- Webhook `apps/web/src/app/api/email/[provider]/events/route.ts`: signature validation; map `delivered/bounced/complained/opened/clicked` → `Message.status` by `providerId`.
- Suppression: `EmailSuppression(email citext PK, reason, createdAt)` + migration; hard bounce and complaint insert; `sendMessage` refuses suppressed addresses (`Message.status = SUPPRESSED`); admin platform page to view/remove entries (owner/platform admin).
- Tests: fixture webhooks for each event type; suppression enforced; SMTP path unchanged.

## Out of scope
- Marketing analytics. DNS setup (DOC-002).

## Acceptance criteria
- [ ] Bounce webhook → `Message.status = BOUNCED` and `EmailSuppression` row; next `sendMessage` to that address → SUPPRESSED, no provider call (vitest with Postgres).
- [ ] Invalid webhook signature → 403.
- [ ] `EMAIL_PROVIDER=smtp` local flow still lands in Mailpit (existing e2e passes).

## Files
- `packages/shared/src/email.ts` → `packages/shared/src/email/{index,smtp,console,resend,ses,postmark}.ts`, tests, `packages/shared/src/env.ts`, `packages/shared/src/messaging.ts`
- `apps/web/src/app/api/email/[provider]/events/route.ts` (new), `apps/admin/src/app/platform/suppressions/page.tsx` (new), `packages/db/prisma/schema.prisma` + migration

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
```

## Notes for agents
First failing test: bounce → suppression → next send suppressed. Keep provider payload parsing in the adapter module so the webhook route stays provider-agnostic.
