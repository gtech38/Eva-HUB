---
id: ADM-014
title: Resumable multipart uploader with abort and cleanup
labels: [type:feature, area:admin, priority:p0, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [SHR-007]
epic: EPIC-GALLERY
---

## Context
docs/04 Phase 1: "drag a folder in, resumable multipart upload, progress bar, deduplication by checksum." `Uploader.tsx` hashes, does one PUT with concurrency 3, and cannot resume. A 2,000-photo wedding at 25 MB each is 50 GB; a tab reload today restarts everything.

## Scope
- `beginUpload` returns `{ mode: "single" | "multipart", uploadId?, partSize, partUrls? }`; new actions `signParts(photoId, uploadId, partNumbers)` (signs on demand, 20 at a time), `completeUpload(photoId, uploadId, parts[])`, `abortUpload(photoId)` (aborts multipart and deletes the `Photo(UPLOADING)` row).
- Client: queue with concurrency 4 files × 3 parts; per-part retry with backoff (3 attempts); persist `{ photoId, uploadId, sha256, completedParts }` in `localStorage` keyed by `eventId` so a reload resumes by re-hashing only files the user re-drops (match by name+size+sha256); "Resume N interrupted uploads" banner; cancel per file and cancel all (abort server-side).
- Folder drop via `webkitGetAsEntry` recursion; skip non-JPEG/PNG with a count; HEIC noted as unsupported.
- Progress: bytes-based overall bar, per-file state, ETA.
- Proxy fallback only when `UPLOAD_PROXY_FALLBACK=true` is exposed by `beginUpload`.

## Out of scope
- Server-side cleanup of abandoned uploads (WRK-005). Worker processing (exists).

## Acceptance criteria
- [ ] Unit tests (vitest, jsdom) for the queue scheduler: respects concurrency, retries a failed part 3 times then fails the file, resumes from `completedParts`.
- [ ] e2e: upload 3 generated 9 MB PNGs (multipart) and 2 small ones (single) → 5 `Photo` rows `UPLOADED`; S3 `headObject` sizes match.
- [ ] e2e: reload mid-upload (route abort via `page.route` on one part URL), re-drop the same files, banner offers resume, upload completes without re-sending completed parts (network log shows fewer PUTs).
- [ ] Cancel aborts the multipart upload (`listMultipartUploads` shows none) and removes the `Photo` row.

## Files
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/{Uploader.tsx,actions.ts}`, `apps/admin/src/lib/upload-queue.ts` (new, pure scheduler), `apps/admin/src/lib/upload-queue.test.ts`
- Read: `packages/shared/src/storage.ts`

## Verification
```bash
pnpm --filter @hub/admin test
pnpm e2e --grep upload
```

## Notes for agents
First failing test: scheduler resume logic. Keep hashing with `crypto.subtle` but stream it (`file.stream()` + incremental SHA-256 via a small WASM or chunked `digest` is not possible with SubtleCrypto; acceptable to hash whole file in memory up to 100 MB and skip dedupe above that with a note).
