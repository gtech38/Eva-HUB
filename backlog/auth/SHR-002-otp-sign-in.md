---
id: SHR-002
title: OTP code sign-in by email and SMS
labels: [type:feature, area:shared, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-AUTH
---

## Context
docs/04-plan.md Phase 1: "OTP sign-in that doesn't reveal who's on the guest list." docs/01 §9 lists "One-time code by SMS" as a core method. Today `requestSignIn` in `apps/web/src/app/sites/[slug]/auth/actions.ts` only sends a magic link, and over SMS it sends a long URL (expensive in UCS-2, awkward to tap). `LoginToken.purpose` already has `OTP` and `newOtp()` exists.

## Scope
- `packages/shared/src/auth.ts`: `issueLoginCode({ channel, sentTo, userId, eventId })` creates a `LoginToken(purpose: OTP)` storing `hashToken(code)` with 10-minute expiry and `attempts` counter (add `attempts Int @default(0)` to `LoginToken`); `verifyLoginCode(sentTo, code)` is constant-time, increments attempts, burns on success, fails closed after 5 attempts.
- Web sign-in: SMS channel always sends a code (`"<title>: your sign-in code is 123456"`); email sends both link and code. New step in `SignIn.tsx`: after submit, show a code input (same neutral message); `verifySignIn` server action creates an `EMAIL_OTP`/`SMS_OTP` session and links guests via `linkGuestsForContact`.
- Response text identical regardless of eligibility; for ineligible addresses create a dummy token row as `apps/admin/src/app/login/actions.ts` does, so timing is similar.
- Message rows (`purpose: OTP`) recorded like magic links.
- i18n strings for the code step in `packages/shared/src/i18n.ts` (en/te/hi).

## Out of scope
- Rate limiting (SHR-003; this ticket only adds per-token attempt cap). Admin OTP UI (WEB-005). Passkeys (WEB-008).

## Acceptance criteria
- [ ] `verifyLoginCode` rejects a wrong code, a used code, an expired code and the 6th attempt; accepts the right one once (vitest with Postgres).
- [ ] Guest with phone only can sign in on the event site end to end via console SMS output captured in a vitest-mocked `sms()`; e2e covers the email path via Mailpit (code copied from the email body).
- [ ] Unknown address and known address produce byte-identical responses and both render the code input.
- [ ] `AuditLog` row `auth.otp` written on success.

## Files
- `packages/shared/src/auth.ts`, `packages/shared/src/auth.test.ts`, `packages/shared/src/i18n.ts`
- `packages/db/prisma/schema.prisma` (+ migration `login_token_attempts`)
- `apps/web/src/app/sites/[slug]/auth/actions.ts`, `apps/web/src/components/SignIn.tsx`
- `e2e/specs/web/signin.spec.ts`

## Verification
```bash
pnpm --filter @hub/shared test
pnpm e2e --grep "sign-in code"
```

## Notes for agents
First failing test: `verifyLoginCode` rejects after 5 attempts. Keep enumeration-safety as a test, not a comment. Codes are 6 digits from `crypto.randomInt`, not `Math.random` (replace `newOtp`).
