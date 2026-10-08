---
id: DB-003
title: Tenant isolation test suite
labels: [type:feature, area:db, area:web, area:admin, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-003, DB-002, ADM-002]
epic: EPIC-TENANCY
---

## Context
docs/04-plan.md: "Tenant data leaks in SaaS mode — trust-ending." The policy tests cover `can()` in isolation; nothing proves that a signed-in user from studio B gets nothing from studio A through real HTTP. This suite is the regression net for EPIC-TENANCY and the baseline for the Phase 3 pen test.

## Scope
- Fixture builder `e2e/lib/tenants.ts`: creates studio A and studio B, one event each with a guest, a host, an album with a READY photo, a `ZipExport`, an `Entitlement`, a `FaceCluster`; returns ids and signs in principals (owner A, host A, guest A, owner B).
- `e2e/specs/isolation.spec.ts` (Playwright `request` fixture, no browser needed):
  - owner B → `GET http://<slugA>.localhost:3000/` shows the sign-in gate (no `site.view`).
  - guest A on site A → `GET /api/photos/<photoB>/download` is 404.
  - owner B → admin `GET /studios/<A>/events/<eA>` is 404; server actions `setPhotoHidden`, `grantGalleryUnlock`, `resendInvite` called with studio-A ids via a direct `fetch` of the action endpoint return a forbidden `ActionState`.
  - owner B → `PUT /api/upload?photoId=<photoA>` is 403/404.
  - host A → `POST /api/face/search` on site B is 401/403.
  - `/_next/data` and `/sites/<slug>` literal paths are not reachable (middleware rewrite).
- vitest DB-level suite `packages/db/src/tenant-isolation.test.ts`: for each model in `EVENT_MODELS`, `tenantClient(A).<model>.count()` equals the count filtered by hand, and never includes B rows (generated per model).

## Out of scope
- RLS (DB-004) — this suite must pass before and after RLS.

## Acceptance criteria
- [ ] Every assertion above passes; removing the `eventId` filter from `apps/web/src/app/api/photos/[id]/download/route.ts` makes the download case fail.
- [ ] The generated per-model DB suite covers every model in `EVENT_MODELS` (test count equals model count).
- [ ] Suite runs in CI (`e2e` job).

## Files
- `e2e/lib/tenants.ts`, `e2e/specs/isolation.spec.ts`, `packages/db/src/tenant-isolation.test.ts` (new)
- Read: `packages/db/src/tenant.ts`, `apps/web/src/middleware.ts`

## Verification
```bash
pnpm --filter @hub/db test
pnpm e2e --grep isolation
```

## Notes for agents
Calling Next server actions over HTTP needs the action id header; simpler is to exercise them via the UI form submit with the foreign ids injected into hidden inputs (`page.evaluate`). Keep fixtures idempotent and cleaned up.
