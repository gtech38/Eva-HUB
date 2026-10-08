---
id: SHR-007
title: S3 CORS configuration and multipart presign helpers (RustFS and R2)
labels: [type:feature, area:shared, area:infra, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-GALLERY
---

## Context
Direct browser → S3 `PUT` fails locally because the RustFS bucket has no CORS rules, so `Uploader.tsx` silently falls back to `PUT /api/upload` which buffers whole files in the Next process. docs/04 Phase 0 "Storage adapter: presigned multipart upload and presigned GET, tested against both MinIO and R2". `storage.ts` has a comment "Multipart upload is a Phase-1 follow-up".

## Scope
- `infra/docker-compose.yml` `s3-init`: after `mb`, apply `aws s3api put-bucket-cors` with a rule allowing `PUT, GET, HEAD, POST` from `http://localhost:3001` and `http://*.localhost:3000` with `ETag` exposed (needed to complete multipart). Document the equivalent R2 CORS JSON in `docs/deploy/storage.md` (DOC-006 owns the file; create a stub here).
- `packages/shared/src/storage.ts`: `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNumber)`, `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)`, `listMultipartUploads(prefix)`; part size constant 8 MiB, single-PUT path kept for files ≤ 8 MiB.
- Integration test `packages/shared/src/storage.int.test.ts` (runs when `S3_ENDPOINT` reachable): create → upload 2 parts via presigned URLs with `fetch` → complete → `headObject` size matches; abort removes the upload; CORS preflight `OPTIONS` from origin `http://localhost:3001` returns the allow headers.
- `UPLOAD_PROXY_FALLBACK` env (default `false`): the proxy route refuses with 404 when off.

## Out of scope
- The browser uploader (ADM-014). Stale upload cleanup (WRK-005).

## Acceptance criteria
- [ ] `curl -X OPTIONS -H 'Origin: http://localhost:3001' -H 'Access-Control-Request-Method: PUT' http://localhost:9000/hub-media/x` returns `Access-Control-Allow-Origin`.
- [ ] Integration test completes a 2-part multipart upload against RustFS.
- [ ] With `UPLOAD_PROXY_FALLBACK=false`, `PUT /api/upload` returns 404.
- [ ] Existing single-PUT `presignUpload` unchanged.

## Files
- `infra/docker-compose.yml`, `infra/s3/cors.json` (new), `packages/shared/src/storage.ts`, `packages/shared/src/storage.int.test.ts`, `packages/shared/src/env.ts`, `apps/admin/src/app/api/upload/route.ts`, `docs/deploy/storage.md` (stub)

## Verification
```bash
pnpm infra:nuke && pnpm infra:up
pnpm --filter @hub/shared test   # int test picks up S3_ENDPOINT from .env
```

## Notes for agents
Write the OPTIONS preflight assertion first (fails today). RustFS follows the MinIO API; if `put-bucket-cors` is unsupported, fall back to the console env `RUSTFS_CORS_ALLOWED_ORIGINS` and record which worked in the storage doc.
