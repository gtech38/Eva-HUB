# ADR-0005: RustFS as the local S3 server because MinIO images were withdrawn

- Status: Accepted
- Date: 2026-10-08
- Tickets: INF-020, SHR-007, DOC-012

## Context

ADR-0002 requires only the S3 API, and the local stack needs an S3-compatible server in `docker compose`. docs/01 sections 2 and 11 and docs/04 name MinIO for local development. MinIO's public container images were withdrawn, so `docker compose pull` of the planned image fails.

## Decision

`infra/docker-compose.yml` runs `rustfs/rustfs:latest` (S3 API on 9000, console on 9001) with the credentials `minio` / `minio12345`, and an `s3-init` job (`amazon/aws-cli`) that waits for the endpoint and creates the `hub-media` bucket. The application is unchanged and keeps the same `S3_*` environment variables, so MinIO, R2 or S3 would work by changing only the endpoint and keys. Production targets are R2 or S3 per ADR-0002; nothing in production uses RustFS.

## Consequences

- Local development works with one `pnpm infra:up`. RustFS has no CORS configuration locally, so browser uploads use the admin `/api/upload` proxy; SHR-007 adds CORS configuration and multipart helpers tested against both RustFS and R2.
- Behavioural differences (presign edge cases, multipart limits, listing order) can hide until run against R2; storage tests should not assume RustFS specifics.
- The image tag is `latest`, so a breaking upstream change can surface on the next pull; pin a digest if that happens.
- docs/01 and docs/04 still name MinIO as the local server; the README and `.env.example` only keep `minio` / `minio12345` as the credentials. DOC-012 refreshes the docs.

## Alternatives

- MinIO: the original plan, no longer pullable from its public registry.
- A real cloud bucket per developer: creates cloud resources, which this repo does not do (CLAUDE.md "Providers").

## References

- `infra/docker-compose.yml`
- `.env.example`
- `packages/shared/src/storage.ts`
- `apps/admin/src/app/api/upload/route.ts`
- `docs/01-architecture.md` section 2
