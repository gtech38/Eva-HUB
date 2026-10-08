# ADR-0002: S3 API only for storage; R2 recommended; fixed key layout

- Status: Accepted
- Date: 2026-10-08
- Tickets: SHR-007, SHR-008, INF-020

## Context

Photo delivery is mostly egress (galleries, full-resolution downloads, 30 GB zips) and the product must stay host-agnostic (docs/01 section 2, docs/04 risks). Both TypeScript and the Python worker read and write objects. Originals must never be served through a public path.

## Decision

All object access goes through the S3 API with a configurable endpoint: `@aws-sdk/client-s3` in `packages/shared/src/storage.ts` and `boto3` in `workers/media/hub_worker/storage.py`, configured by `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `S3_FORCE_PATH_STYLE`. No provider-specific SDK or feature is used. Cloudflare R2 is the recommended production target because it has zero egress fees; S3, B2 and Wasabi work unchanged.

Keys are derived from the row alone and always start with the tenant: `s/{studioId}/e/{eventId}/orig/{photoId}.{ext}` (originals), `.../d/{photoId}/{variant}-{rand}.jpg` (derivatives, random suffix so URLs are unguessable and revocation is key rotation), `.../site/hero-{rand}.jpg`, `.../zip/{zipId}-{part}.zip`. Browsers receive short-lived presigned URLs signed against `S3_PUBLIC_ENDPOINT`; originals are only presigned after a `can()` and entitlement check.

## Consequences

- Switching provider is an environment change plus bucket setup; no caller changes.
- Tenant prefix makes per-studio lifecycle rules, export and deletion a prefix operation.
- Provider quirks must be handled generically: the local server has no CORS, so uploads fall back to the admin `/api/upload` proxy (SHR-007 adds CORS and multipart helpers).
- Public CDN in front of derivatives is a separate decision (SHR-008); regional placement is INF-020.

## Alternatives

- A provider-specific SDK or feature (for example R2 bindings): ties deployment to one vendor, against the provider-agnostic rule, and has no local equivalent.
- Serving originals from a public bucket path: would bypass entitlements and watermarking.

## References

- `packages/shared/src/storage.ts`
- `apps/web/src/app/api/photos/[id]/download/route.ts`
- `workers/media/hub_worker/storage.py`
- `packages/shared/src/env.ts`
- `apps/admin/src/app/api/upload/route.ts`
- `docs/01-architecture.md` section 2
