---
id: DB-002
title: Tenant-scoped Prisma client extension
labels: [type:feature, area:db, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-TENANCY
---

## Context
`scoped()` in `packages/db/src/index.ts` only returns where-fragments and casts `undefined as never` when `eventId` is missing, which compiles and leaks at runtime. CLAUDE.md's rule "every event-owned query filters by eventId" is enforced by nobody. A `$extends` client that injects scope into `where`/`data` for every tenant model is the mechanism docs/03-data-model.md §2.13 describes.

## Scope
- `packages/db/src/tenant.ts`: `tenantClient(ctx: { studioId: string; eventId?: string })` built with `prisma.$extends({ query: { $allModels: { ... } } })`.
  - Model classification table: `STUDIO_MODELS` (Event, Household, Guest, Album, Photo, Message, Order, PriceSheet, Domain, StudioMember, ZipExport), `EVENT_MODELS` (everything with `eventId`: EventMember, EventPage, SubEvent, Household, Guest, Album, Photo, Face, FaceCluster, RegistryItem, CashFund, ReminderRule, ProofingList, ZipExport, Entitlement, Message), `GLOBAL_MODELS` (User, ContactPoint, Session, LoginToken, Job, AuditLog, BiometricConsent, FaceProfile, PhotoMatch, Favorite, Rsvp, SubEventInvite, MealOption, InviteToken, RegistryClaim, Contribution, OrderItem, PrintFulfillment, Product, Studio).
  - For `find*`, `count`, `aggregate`, `groupBy`, `update*`, `delete*`: merge `{ studioId }` and (when the model has it) `{ eventId }` into `where` with `AND`; for `create`/`upsert`/`createMany`: inject into `data` and throw `TenantScopeError` if the caller supplied a different value.
  - Calling an EVENT_MODEL operation on a context without `eventId` throws `TenantScopeError` at runtime and is a type error (`EventScopedClient` vs `StudioScopedClient` return types).
  - Models reached only via relation (`Rsvp`, `Face`) are documented as "scope through the parent".
- Keep the unscoped `prisma` export for platform-admin pages, auth and the job queue, but rename the weak `scoped()` to `legacyScoped()` and mark `@deprecated`.
- Unit tests with a real Postgres (`packages/db/src/tenant.test.ts`): a scoped client for studio A returns 0 rows for studio B's event; `create` with a foreign `eventId` throws; `update` with `where: { id }` only affects rows in scope.

## Out of scope
- Rewriting the apps to use it (ADM-002). RLS (DB-004).

## Acceptance criteria
- [ ] `tenantClient({ studioId: A, eventId: eA }).photo.findMany()` never returns a photo from event eB even when `where: { id: photoFromB }` is passed.
- [ ] `tenantClient({ studioId: A }).photo.findMany()` is a TypeScript error and throws at runtime.
- [ ] `tenantClient(...).photo.create({ data: { eventId: eB, ... } })` throws `TenantScopeError`.
- [ ] All existing tests and typecheck pass.

## Files
- `packages/db/src/index.ts`, `packages/db/src/tenant.ts` (new), `packages/db/src/tenant.test.ts` (new)
- Read: `packages/db/prisma/schema.prisma`

## Verification
```bash
pnpm --filter @hub/db test
pnpm typecheck
```

## Notes for agents
Write `tenant.test.ts` first against seeded data (two studios: seed only has one; create the second in the test). Prisma 6 `$extends` query component: `args.where = { AND: [args.where ?? {}, scope] }`. Avoid `any`; derive model names from `Prisma.ModelName`.
