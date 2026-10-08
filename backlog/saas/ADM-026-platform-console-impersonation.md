---
id: ADM-026
title: Platform admin console with audited support impersonation
labels: [type:feature, area:admin, priority:p3, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [ADM-003, DB-004]
epic: EPIC-SAAS
---

## Context
docs/04 Phase 3: "Platform admin console: studios, usage, support impersonation with audit." `/platform` lists studios, jobs, audit and users. Support needs to see what a studio user sees without asking for credentials, and the studio must be able to see that it happened.

## Scope
- Studio list with usage (ADM-025 snapshots), plan, status, last activity; studio detail with events, members, recent audit.
- Impersonation: "View as <user>" for platform admins → creates a `Session` with `authMethod` of the target? No: new `Session.impersonatorUserId String?` (+ migration); principal carries `impersonating: true`; policy: impersonated sessions can never do `studio.manage`, `entitlements.grant`, refunds, member management or anything under `platform.*` (policy test), and cannot run face search or create consents (biometric actions must be the person's own); banner on every admin page "Viewing as X — exit"; 1-hour max; `AuditLog user.impersonate.start/stop` with `studioId` so it shows in that studio's audit page (ADM-023) — studios see "Platform support viewed your studio on <date>".
- Reason required (free text) stored in audit `data`.
- Search users by verified contact (platform admin only; constant-time response shape).

## Out of scope
- Impersonating guests on event sites (admin only).

## Acceptance criteria
- [ ] Policy tests: impersonated principal is denied the listed actions and allowed `studio.view`/`gallery.view`.
- [ ] Starting impersonation writes the start audit row with reason; the studio's audit page lists it (vitest with Postgres).
- [ ] Session expires after 1 h regardless of `SESSION_TTL_DAYS` (unit on `createSession` options).
- [ ] e2e: platform admin views a studio as its owner, sees the banner, exits, original session restored.

## Files
- `packages/shared/src/{policy.ts,policy.test.ts,auth.ts}`, `packages/db/prisma/schema.prisma` + migration
- `apps/admin/src/app/platform/{page.tsx,studios/[studioId]/page.tsx,actions.ts}`, `apps/admin/src/components/Shell.tsx` (banner), `apps/admin/src/lib/auth.ts`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
pnpm e2e --grep impersonat
```

## Notes for agents
First failing test: policy denial list. The impersonation session must store the real actor; every audit row written during it must use `actorUserId = impersonatorUserId` with `data.onBehalfOf`.
