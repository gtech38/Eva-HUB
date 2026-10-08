---
id: WEB-018
title: Zip export UI: request, poll, download parts, cached reuse (gallery and favorites scopes)
labels: [type:feature, area:web, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [DB-001]
epic: EPIC-GALLERY
---

## Context
The worker's `BUILD_ZIP {zipExportId}` streams originals into ≤ 2 GB parts and updates `ZipExport.partKeys/status`, but nothing in `apps/web` creates a `ZipExport`, enqueues the job, or serves the parts. docs/04 MVP "done when": "the zip download works." docs/01 §5: "The user gets the link by email and in the UI. Built zips are cached until the next upload or visibility change."

## Scope
- Server action `requestZip(scope: "gallery" | "favorites" | { albumId })` in `gallery/actions.ts`: requires `gallery.view` + full-res entitlement (`isEntitledFullRes` or `viewer.isStudio`); computes `scopeHash = sha256(sorted visible photo ids + scope + viewer-visibility class)`; reuses a `ZipExport(READY)` with the same `eventId+scopeHash` if present, else creates `ZipExport(QUEUED, studioId, eventId, scopeHash, requestedByUserId)` and enqueues `BUILD_ZIP {zipExportId, photoIds?}` with `dedupeKey zip:<id>`; audits `zip.request`.
- Add `requestedByUserId String?`, `scope Json?`, `completedAt DateTime?` to `ZipExport` (+ migration); worker reads `photoIds` from the payload when present (favorites/album scope) else uses its current query.
- Route `GET /api/zips/[id]` returns status + part list for the requester (or any entitled viewer of the same scope); `GET /api/zips/[id]/[part]` re-checks entitlement and 302s to a 5-minute presigned GET with `Content-Disposition` `"<slug>-photos-<n>of<m>.zip"`; audits `zip.download`.
- UI on `/gallery`: "Download all (N photos)" and "Download my favorites" buttons when entitled; a `ZipStatus` client component polling every 5 s showing QUEUED/BUILDING progress (parts done) and download links per part; locked state explains that the hosts' package unlocks downloads.
- Email the requester a `GALLERY_READY` message when the zip is READY (via SHR-005 when available; until then, the UI only).

## Out of scope
- Invalidation on upload/visibility change and worker-side notice (WRK-007). Payments (EPIC-COMMERCE).

## Acceptance criteria
- [ ] `scopeHash` is stable for the same visible set and changes when a photo is hidden (unit test).
- [ ] Two requests for the same scope create one `ZipExport` (vitest with Postgres).
- [ ] Non-entitled viewer gets `ok: false, reason: "not_entitled"`; part route returns 403 for them and 302 for an entitled viewer (vitest route tests).
- [ ] e2e (worker running): request zip for the seed gallery → status becomes READY → part link downloads a valid zip containing the expected filenames.

## Files
- `apps/web/src/app/sites/[slug]/gallery/{actions.ts,page.tsx}`, `apps/web/src/components/gallery/ZipStatus.tsx` (new), `apps/web/src/app/api/zips/[id]/{route.ts,[part]/route.ts}` (new), `apps/web/src/lib/zips.ts` (new)
- `packages/db/prisma/schema.prisma` + migration `zip_export_scope`
- `workers/media/hub_worker/handlers/build_zip.py` (payload `photoIds`)

## Verification
```bash
pnpm --filter @hub/web test
cd workers/media && make dev &   # then
pnpm e2e --grep zip
```

## Notes for agents
First failing test: `scopeHash` stability. The e2e needs the worker; mark it `test.skip` when `WORKER_INTERNAL_URL/health` is unreachable and run it in CI's e2e job where the worker is started.
