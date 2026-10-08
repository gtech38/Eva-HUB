---
id: WEB-006
title: Account settings: contact points, verification, face profile, delete my data
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-002]
epic: EPIC-AUTH
---

## Context
docs/01 §6 "Revoking the profile from account settings deletes it immediately" and docs/02 §2 rule 5 "Save your account adds a second contact point". No account page exists in `apps/web`; `User.status` never moves to `CLAIMED` outside the seed; a face profile can be created (`/api/face/search` with `remember=on`) but never revoked. LEG-007 (DSAR spec) needs a "delete my data" entry point.

## Scope
- Route `/account` on every event site (same session, so it works under any `*.ROOT_DOMAIN`) and at the root domain (`apps/web/src/app/root/account`). Requires a non-INVITE_LINK session (step-up via WEB-005 otherwise).
- Sections: display name + locale; contact points (list with verified badge, add email/phone → OTP via SHR-002 `issueLoginCode` → `ContactPoint.verifiedAt` set, `User.status = CLAIMED`, `linkGuestsForContact` run; remove a non-primary contact; set primary); SMS consent toggle (`smsOptOut`); face profile (show `createdAt`, `lastUsedAt`, `modelVersion`, `stale`; "Revoke" deletes `FaceProfile`, sets `BiometricConsent.revokedAt`, audits `consent.revoke`); "Delete my data" button that creates an `AuditLog` `dsar.requested` row and emails the studio owner(s) of events the user belongs to (actual deletion is LEG-007 runbook).
- Adding a contact that already belongs to another user returns "This contact is already in use — merge accounts?" linking to SHR-004 (disabled until that ticket ships).
- Server actions in `apps/web/src/app/sites/[slug]/account/actions.ts`; i18n strings en/te/hi.

## Out of scope
- The merge itself (SHR-004). Passkeys (WEB-008). Automated deletion.

## Acceptance criteria
- [ ] Adding a phone and entering the code creates a verified `ContactPoint` and links any guest rows with that phone (vitest with Postgres).
- [ ] Revoking the face profile removes the `FaceProfile` row, sets `revokedAt` on its consent, and `CLUSTER_FACES` `_match_profiles` no longer selects it (pytest adjustment).
- [ ] INVITE_LINK session visiting `/account` is sent to step-up.
- [ ] e2e: guest adds a second email via Mailpit code and the page shows it verified.

## Files
- `apps/web/src/app/sites/[slug]/account/{page.tsx,actions.ts}` (new), `apps/web/src/app/root/account/page.tsx` (new), `apps/web/src/components/chrome.tsx` (link)
- `packages/shared/src/auth.ts`, `packages/shared/src/i18n.ts`
- `workers/media/tests/test_jobs.py` (profile revoked case)

## Verification
```bash
pnpm --filter @hub/web test
pnpm e2e --grep account
cd workers/media && make test
```

## Notes for agents
First failing test: revoke deletes `FaceProfile` and sets `revokedAt`. Contact removal must refuse to remove the last verified contact.
