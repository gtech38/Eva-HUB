---
id: SHR-004
title: Duplicate-user merge flow with dual-channel OTP
labels: [type:feature, area:shared, area:web, area:admin, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-002, WEB-006]
epic: EPIC-AUTH
---

## Context
docs/02 §2 "Merging duplicate users": verifying a second contact that belongs to another user offers a merge, requires a code on both channels, re-points `Guest`, `EventMember`, `Favorite`, `PhotoMatch`, writes `AuditLog`, soft-deletes the duplicate. `User.mergedIntoId` exists in the schema; the admin users page has a disabled "Merge" button.

## Scope
- `packages/shared/src/merge.ts`: `planMerge(keepId, dropId)` returns conflicts (same event guest rows on both → keep the one with RSVPs, soft-delete other; same `(eventId, userId, role)` member; `Favorite`/`PhotoMatch` unique collisions → keep higher score); `executeMerge(plan, actorUserId, reason)` runs in one transaction: re-point `Guest.userId`, `EventMember.userId`, `Favorite.userId`, `PhotoMatch.userId`, `Order.userId`, `BiometricConsent.consentedByUserId`, `Session` (delete drop's), `ContactPoint.userId`; drop's `FaceProfile` deleted if keep has one, else re-pointed; set `mergedIntoId`, `status: DISABLED`, `deletedAt`; `AuditLog user.merge` with the plan.
- Guest flow: from WEB-006 "already in use" → `/account/merge?with=<contact>`: send codes to the current primary contact and to the contested contact; both must verify within 10 minutes; then `executeMerge`.
- Admin flow: `/platform/users` Merge button enabled for platform admins; shows the plan, requires typing the kept user's id, audits `user.merge.admin`.
- `principalFromCookie` already rejects `DISABLED`; add a redirect hint "this account was merged" on sign-in attempts to a merged contact (codes go to the kept user since `ContactPoint` moved).

## Out of scope
- Un-merge. Merging studio memberships (refuse if drop has `StudioMember` rows; surface to platform admin).

## Acceptance criteria
- [ ] Unit test: two users each with a guest row in the same event → plan keeps the one with responded RSVPs and soft-deletes the other guest; after `executeMerge` the event has exactly one non-deleted guest row for the kept user.
- [ ] Unique-constraint collisions (`Favorite`, `PhotoMatch`) never throw; the test seeds a collision.
- [ ] Guest merge requires both codes; a single code does not merge (vitest).
- [ ] Admin merge writes `user.merge.admin` and the dropped user cannot sign in.

## Files
- `packages/shared/src/merge.ts`, `packages/shared/src/merge.test.ts` (new)
- `apps/web/src/app/sites/[slug]/account/merge/{page.tsx,actions.ts}` (new)
- `apps/admin/src/app/platform/users/page.tsx`, `apps/admin/src/app/platform/actions.ts`
- Read: `packages/db/prisma/schema.prisma` (`@@unique([eventId, userId])`, `@@unique([userId, photoId])`)

## Verification
```bash
pnpm --filter @hub/shared test
pnpm --filter @hub/admin test
```

## Notes for agents
Write `planMerge` tests first; keep planning pure and execution a single `prisma.$transaction`. Order the re-pointing so unique indexes are satisfied (delete collisions before updates).
