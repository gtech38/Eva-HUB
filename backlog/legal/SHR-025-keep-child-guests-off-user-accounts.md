---
id: SHR-025
title: Keep child guests off user accounts and out of self-search
labels: [type:bug, area:shared, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-LEGAL
---

## Context
Found while writing the LEG-005 compliance checklist (docs/compliance/biometrics.md, COPPA row P2). docs/01 §6 and the guardian consent text rely on "no child accounts": the child is a `Guest` row and the adult acts for them. Nothing enforces it. The admin guest form accepts an email or phone on an `isChild` guest, `linkGuestsForContact` links any matching unlinked guest including children, and the search route lets a viewer whose guest row is `isChild` run a `SEARCH_SELF` search (only profile enrolment checks `isChild`).

## Scope
- `packages/shared/src/auth.ts` `linkGuestsForContact`: skip guests with `isChild = true`. The invitation route (`apps/web/src/app/sites/[slug]/i/[token]/route.ts`) is a second place a guest gets linked; children are never invited, but give it the same guard.
- `apps/web/src/app/api/face/search/route.ts`: a viewer whose own guest row has `isChild` gets `403 forbidden` for `subject = "me"` (they can still be searched for by a guardian).
- Admin guest form and CSV import: reject (form) or warn (import) an email or phone on a child row, since children are never invited.
- Report: SQL in the PR description listing existing child guests already linked to a user (`Guest.isChild AND userId IS NOT NULL`), so the studio can review them. Do not auto-unlink.

## Out of scope
- Age policy for 13-17 (counsel question P6 in biometrics.md).
- Merging or deleting existing accounts.

## Acceptance criteria
- [ ] A verified contact that matches both an adult and a child guest row links only the adult.
- [ ] A child guest linked before this change cannot start a `SEARCH_SELF` search (403) but can still be the subject of a guardian search.
- [ ] Saving a child guest with an email or phone in the admin form fails with a field error; CSV import flags the row.

## Files
`packages/shared/src/auth.ts` (+ test), `apps/web/src/app/api/face/search/route.ts` (+ `route.test.ts`), `apps/admin/src/app/studios/[studioId]/events/[eventId]/guests/actions.ts` (+ test)

## Verification
```bash
pnpm --filter @hub/shared test
pnpm --filter @hub/web test
pnpm --filter @hub/admin test
```

## Notes for agents
The auth-sessions-policy skill says linking happens only through `resolveUserForVerifiedContact`/`linkGuestsForContact`; the invitation route also updates `Guest.userId` directly. Put the `isChild` rule in one shared helper both call rather than copying it. Update P2 in `docs/compliance/biometrics.md` when done.
