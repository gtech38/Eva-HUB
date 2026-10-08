---
id: ADM-002
title: Migrate web and admin data access to the scoped client
labels: [type:tech-debt, area:admin, area:web, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [DB-002]
epic: EPIC-TENANCY
---

## Context
Every page, route handler and server action in `apps/web/src` and `apps/admin/src` calls the global `prisma` with hand-written `eventId` filters (for example `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/actions.ts` `setPhotoHidden` does `prisma.photo.update({ where: { id } })` after a separate ownership check). One missed filter is a cross-tenant leak.

## Scope
- `apps/web/src/lib/site.ts`: `SiteContext` gains `db: EventScopedClient` built from `event.studioId/event.id`; `requireViewer()` returns it.
- `apps/admin/src/lib/data.ts`: `getEvent(studioId, eventId)` returns `{ event, db }`; `getStudio` returns a studio-scoped client.
- Replace `prisma.<tenantModel>` usages in both apps with the scoped client. Keep global `prisma` only in: auth (`principalFromCookie`), `/platform/**` pages, `Job`/`AuditLog` writes, `User`/`ContactPoint` lookups.
- Add a CI guard script `scripts/check-tenant-scope.mjs`: fails if `prisma.(photo|album|guest|household|event|subEvent|eventPage|registryItem|cashFund|reminderRule|zipExport|entitlement|message|face|faceCluster)\.` appears under `apps/**/src/**` outside an allowlist file. Wire into `pnpm lint`.
- Fix bugs the migration surfaces (expect `setPhotoHidden`, `movePhoto`, `deletePhoto`, `photoStatuses`, `/api/upload` to need an event scope).

## Out of scope
- New features. Worker SQL (it already filters by `eventId` explicitly; RLS in DB-004 covers it).

## Acceptance criteria
- [ ] `node scripts/check-tenant-scope.mjs` reports zero violations and is part of `pnpm lint`.
- [ ] Existing e2e specs (WEB-001, ADM-001) still pass.
- [ ] `PUT /api/upload?photoId=<photo of event B>` with a studio-A principal returns 403/404, verified by a vitest route test with a mocked principal.

## Files
- `apps/web/src/lib/site.ts`, `apps/web/src/lib/gallery.ts`, `apps/web/src/app/**/route.ts`, `apps/web/src/app/**/actions.ts`
- `apps/admin/src/lib/data.ts`, `apps/admin/src/app/studios/[studioId]/**/actions.ts`, `apps/admin/src/app/api/upload/route.ts`
- `scripts/check-tenant-scope.mjs` (new), `package.json`

## Verification
```bash
node scripts/check-tenant-scope.mjs
pnpm typecheck && pnpm test && pnpm e2e
```

## Notes for agents
Run the guard script first; its violation list is the failing test. Migrate file by file, admin gallery actions first (highest blast radius). Do not change behaviour beyond scoping; log anything that looks like a real leak in the PR.
