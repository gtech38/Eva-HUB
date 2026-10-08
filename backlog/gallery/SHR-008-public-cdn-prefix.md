---
id: SHR-008
title: Public CDN prefix for thumbnails and watermarked images
labels: [type:feature, area:shared, area:web, area:infra, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-GALLERY
---

## Context
`storage.derivativeUrl()` presigns a 24 h GET for every thumbnail and every web image on every render; presigned URLs defeat CDN caching and cost CPU. docs/01 §5: "Thumbs and watermarked web images are served through the CDN with long cache lifetimes and unguessable keys. Clean web-size images use short-lived presigned GETs, issued only after an entitlement check."

## Scope
- Env `PUBLIC_DERIVATIVE_BASE_URL` (optional). When set, `publicDerivativeUrl(key)` = `${base}/${key}` for variants `thumb` and `webWm` only; `web` (clean) and originals always presigned. When unset (local), keep presigned with a 24 h TTL but memoise per key per process for 23 h to cut repeated signing.
- Storage layout: keep `d/{photoId}/{variant}-{rand}.jpg`; document that the CDN/bucket policy must expose only keys matching `s/*/e/*/d/*/thumb-*.jpg` and `.../webWm-*.jpg` (R2 custom domain + Cloudflare cache rule, or S3 bucket policy on prefix with object-key condition). Write `docs/deploy/cdn.md`.
- `toPhotoDTOs` / `listVisibleAlbums` use the new function; add `Cache-Control` guidance: derivatives written by the worker get `Cache-Control: public, max-age=31536000, immutable` (set in `process_photo.py` `put_bytes` metadata) because keys are content-addressed by randomness and rotated on hide.
- Hide/rotate (WRK-005) optionally calls `purgeCdn(urls)` adapter (no-op locally).
- Hero images (ADM-013) follow the same rule.

## Out of scope
- Signed CDN cookies. Choosing the CDN vendor.

## Acceptance criteria
- [ ] Unit tests: with base URL set, `thumb`/`webWm` keys produce plain URLs and `web` keys still produce presigned URLs; with it unset, repeated calls for one key within the memo window return the same URL.
- [ ] Rendering a 60-photo page performs 0 presign calls when the base URL is set and entitlement is false (spy on `getSignedUrl`).
- [ ] Worker writes derivatives with the immutable `Cache-Control` metadata (pytest reading `head_object`).
- [ ] `docs/deploy/cdn.md` describes R2 and S3 variants.

## Files
- `packages/shared/src/storage.ts`, `packages/shared/src/storage.test.ts`, `packages/shared/src/env.ts`, `apps/web/src/lib/gallery.ts`
- `workers/media/hub_worker/handlers/process_photo.py`, `workers/media/hub_worker/storage.py`, `docs/deploy/cdn.md` (new)

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/web test
cd workers/media && make test
```

## Notes for agents
First failing test: `web` key must never become a plain URL. Never put originals under any public prefix.
