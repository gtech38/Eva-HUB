---
name: s3-object-storage
description: Use when reading or writing objects in the bucket from TS (packages/shared/src/storage.ts) or Python (workers/media/hub_worker/storage.py): key layout s/{studioId}/e/{eventId}/orig|d|site|zip, presignUpload/presignDownload, derivativeUrl, S3_ENDPOINT vs S3_PUBLIC_ENDPOINT, RustFS locally and its missing CORS (admin /api/upload proxy fallback), bucket init in compose, switching to R2/S3/B2 by env, and inspecting the bucket with the aws CLI container or the RustFS console on :9001.
---

# S3-compatible object storage

## When this applies
- Uploading, serving, deleting or listing photos, derivatives, hero images or zips.
- Presigned URL issues (403, CORS, wrong host).
- Pointing the stack at a different bucket provider.

## Where things live

| Path | What |
|---|---|
| `packages/shared/src/storage.ts` | `keys.{original,derivativePrefix,hero,zip}`, `presignUpload(key, contentType, ttl=900)`, `presignDownload(key, ttl=300, filename?)`, `derivativeUrl(key)` (24 h presigned GET), `putObject`, `headObject`, `deleteObject` |
| `workers/media/hub_worker/storage.py` | boto3 client (path style, 5 retries), `get_bytes`, `get_stream`, `head`, `put_bytes`, `put_file` (multipart for zip parts), `delete`, `keys.{original,derivative,zip}`, `rand8()` |
| `packages/shared/src/env.ts` | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT?`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` |
| `infra/docker-compose.yml` | `s3` = `rustfs/rustfs:latest` (API :9000, console :9001, creds `minio`/`minio12345`), `s3-init` = `amazon/aws-cli` one-shot that creates bucket `hub-media` |
| `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/actions.ts` | `beginUpload` (checksum dedupe, presigned PUT + `fallbackUrl`), `completeUpload` (`headObject` then `enqueue("PROCESS_PHOTO")`) |
| `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/Uploader.tsx` | browser: sha256 -> `beginUpload` -> XHR PUT to presigned URL -> on network error PUT to `/api/upload?photoId=` -> `completeUpload` |
| `apps/admin/src/app/api/upload/route.ts` | server-side proxy PUT (checks `photos.upload`, status `UPLOADING`, JPEG/PNG only) |
| `apps/web/src/app/api/photos/[id]/download/route.ts` | 302 to `presignDownload(originalKey, 300, filename)` after visibility + entitlement |
| `apps/web/src/lib/gallery.ts` `toPhotoDTOs` | picks `web` vs `webWm` derivative by entitlement; `derivativeUrl()` for thumbs |
| `apps/admin/scripts/smoke-upload.mts` | end-to-end check: lists photos, PROCESS_PHOTO jobs, does a curl presigned PUT |

## Key layout (identical in TS and Python)

| Object | Key | Written by |
|---|---|---|
| Original | `s/{studioId}/e/{eventId}/orig/{photoId}.{jpg|png}` | browser/admin proxy |
| Derivative | `s/{studioId}/e/{eventId}/d/{photoId}/{thumb|web|webWm}-{8 hex}.jpg` | worker `PROCESS_PHOTO` |
| Hero image | `s/{studioId}/e/{eventId}/site/hero-{rand}.jpg` | (helper exists; no uploader yet) |
| Zip part | `s/{studioId}/e/{eventId}/zip/{zipId}-{n}.zip` | worker `BUILD_ZIP` |

The random suffix on derivatives makes URLs unguessable; "rotate the key" is how a leaked derivative URL is revoked (planned, see TODO in `setPhotoHidden`).

## Conventions in this repo
- **Only the S3 API, only through these two modules.** No provider SDKs elsewhere; no public bucket paths. Originals are never served without `presignDownload` after an entitlement check.
- **Two clients in TS:** `s3()` for server-side calls signs against `S3_ENDPOINT`; `s3(true)` for URLs the browser will hit signs against `S3_PUBLIC_ENDPOINT ?? S3_ENDPOINT`. A presigned URL is only valid for the host it was signed for -- that is why the split exists (e.g. `http://s3:9000` inside Docker vs `http://localhost:9000` for the browser).
- `derivativeUrl()` is a 24 h presigned GET locally; production intends a CDN with long cache and the same unguessable keys (docs/01 §5). Callers never build URLs by hand.
- Uploads are **single PUT presigns** (`ContentType` is part of the signature; the browser must send the same `Content-Type`). Multipart is a noted follow-up in `storage.ts`.
- Dedupe by SHA-256 before upload: `Photo @@unique([eventId, checksum])`; `beginUpload` returns `duplicate: true` or re-uses an `UPLOADING`/`FAILED` row.
- Python `put_file` uses `upload_file` (automatic multipart) for zip parts up to 2 GB.
- Local creds are literally `minio` / `minio12345` (names kept from the MinIO era; the server is RustFS).

## Common tasks

### Add a new object kind (e.g. album cover upload)
1. Test first: `packages/shared/src/storage.test.ts` asserting `keys.albumCover(s, e, a, r)` equals `s/${s}/e/${e}/site/album-${a}-${r}.jpg` (pure, no network). Mirror a `test_keys` in `workers/media/tests/` if Python writes it.
2. Add the helper to `keys` in both `storage.ts` and `storage.py` (keep the table above in sync).
3. Server action: `presignUpload(key, type)` + return `fallbackUrl` as `beginUpload` does; or `putObject` directly if the file arrives via a server action (<= 4 MB admin body limit).
4. Serve with `derivativeUrl(key)`.

### Debug a failing browser upload
1. `pnpm exec tsx apps/admin/scripts/smoke-upload.mts <slug>` -- confirms presigned PUT works from the server's network (curl) and shows `Photo`/`Job` state.
2. If curl works but the browser fails with a network error: that is CORS on RustFS (no CORS config applied locally). The `Uploader` already falls back to `/api/upload`. If the fallback also fails, check the admin dev log for 403/409/415 from the proxy.
3. If `completeUpload` says "Object not found": `headObject` failed -- the PUT went to a different key/host. Compare `S3_PUBLIC_ENDPOINT` with what the browser can reach.

### Inspect the bucket
```bash
# aws CLI in a container (no local install needed)
docker run --rm --network event-hub_default -e AWS_ACCESS_KEY_ID=minio -e AWS_SECRET_ACCESS_KEY=minio12345 -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli --endpoint-url http://s3:9000 s3 ls s3://hub-media/s/ --recursive | head
# or the compose service that created the bucket
docker compose -f infra/docker-compose.yml run --rm s3-init
# RustFS console
open http://localhost:9001      # minio / minio12345
```
From TS: `await storage.headObject(key)`; from Python: `storage.head(key)`.

### Switch provider (R2 / S3 / B2 / Wasabi)
Only `.env` changes:
```
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # R2; omit/AWS default for S3
S3_PUBLIC_ENDPOINT=https://<same or CDN origin>
S3_REGION=auto                                            # R2 uses "auto"; S3 real region
S3_BUCKET=hub-media
S3_ACCESS_KEY=... S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=false                                 # virtual-hosted on AWS; R2 accepts either
```
Then configure CORS on the bucket for `PUT` from the admin origin so direct uploads work without the proxy. Both clients already honour these vars; nothing in code changes. Verify with the smoke script.

### Delete objects when a photo is deleted
Not implemented (`deletePhoto` has a TODO). Plan: enqueue a worker job that deletes `originalKey` and every key under `keys.derivativePrefix(...)` (`list_objects_v2` by prefix in Python). Write the Python handler test first against a fake `storage` module.

## Gotchas
- `.env.example` still says "MinIO locally"; compose uses **RustFS** because MinIO's public images were withdrawn. Same API, same creds.
- RustFS has no CORS configured, so presigned PUTs from the browser fail with a bare network error -- expected locally; the proxy fallback handles it. Do not "fix" this by making the bucket public.
- A presigned URL includes `Content-Type` in the signature when `ContentType` was passed to `PutObjectCommand`; the browser must send exactly that header (the `Uploader` does).
- `headObject` swallows all errors and returns `null` -- a wrong endpoint looks like "object missing".
- Compose network name is `event-hub_default` (project name `event-hub` in the compose file); inside it the host is `s3:9000`, outside it `localhost:9000`.
- `presignDownload` quotes `filename` in `Content-Disposition` and strips `"`; non-ASCII filenames are passed raw (no RFC 5987 encoding yet).
- The `s3-init` container exits after creating the bucket; `docker compose ps` showing it exited is normal.
- `derivativeUrl` TTL is 24 h; a page cached longer than that shows broken thumbnails. All pages are `no-store`, so this only bites in screenshots/tests that reuse URLs.

## Verification
```bash
pnpm infra:up && docker compose -f infra/docker-compose.yml logs s3-init | tail -2    # "bucket ready"
cd apps/admin && pnpm exec tsx scripts/smoke-upload.mts priya-arjun                  # curl presigned PUT -> HTTP 200; headObject OK
cd ../../workers/media && .venv/bin/python -c "from hub_worker import storage; print(storage.client().list_buckets()['Buckets'])"
```

## References
- `docs/01-architecture.md` §2 (R2 recommended for zero egress) and §5 (storage layout, serving rules, zips)
- `CLAUDE.md` Storage rule
- AWS SDK v3 presigner: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/
- RustFS: https://rustfs.com/docs/
- Related skills: `python-media-worker`, `admin-app-patterns`, `docker-local-infra`
