---
id: EPIC-GALLERY
title: Gallery, uploads, storage hygiene and downloads
labels: [type:epic, area:web, priority:p0, size:L]
milestone: Phase 1 — MVP
---

## Context
The gallery works end to end locally but several pieces are POC-grade: album pages load every photo in one query (`gallery/[albumId]/page.tsx`); the uploader does a single presigned PUT and falls back to a server proxy because RustFS has no CORS config; hiding a photo does not rotate derivative keys and deleting one leaves S3 objects (`deletePhoto` has a TODO); `derivativeUrl` presigns every thumbnail on every render; the worker builds zips (`BUILD_ZIP`) but no UI requests or serves them; proofing lists, favorites download, manual ordering and album covers are missing. docs/01 §5 is the target design.

## Children
- WEB-017 Keyset pagination and virtualised album grid
- SHR-007 S3 CORS and multipart presign helpers
- ADM-014 Resumable multipart uploader
- WRK-005 S3 hygiene jobs: rotate derivatives on hide, delete objects, abort stale multipart uploads
- SHR-008 Public CDN prefix for thumbnails and watermarked images
- WEB-018 Zip export UI with cached ZipExport reuse (incl. favorites scope)
- WRK-007 BUILD_ZIP scope hashing, invalidation and ready notice
- WEB-019 Proofing lists (guest selection + admin view)
- ADM-017 EXIF sort, manual reorder and album covers
- WRK-018 Tag derivative and zip objects hub-class=derived for lifecycle rules

## Definition of Done
- [ ] A 2,000-photo album scrolls smoothly on a mid-range phone and the first page returns in under 300 ms server time.
- [ ] A 500-file folder uploads directly to the bucket with resume after a reload; the proxy fallback is opt-in only.
- [ ] Hiding or deleting a photo leaves no reachable URL and no orphaned object.
- [ ] A guest with the unlock entitlement can request a zip and download its parts; repeat requests reuse the built archive.
