# CLAUDE.md — Event & Photo Delivery Hub

Multi-tenant event-site + photo-delivery platform. Planning docs in `docs/` are the source of design intent; `packages/db/prisma/schema.prisma` is the source of truth for data.

## Layout

```
apps/web        Next.js 15 — guest-facing event sites (*.ROOT_DOMAIN), port 3000
apps/admin      Next.js 15 — platform/studio/host management, port 3001
packages/db     Prisma schema, migrations, seed, `prisma` client, `enqueue()` job helper
packages/shared env(), i18n (t/ui), page content Zod schemas, can() policy, storage (S3), email, sms, auth
workers/media   Python 3.13 — job consumer (derivatives, face index, clustering, zips) + FastAPI /embed-selfie
infra/          docker-compose: Postgres+pgvector (5433), RustFS S3 (9000/9001), Mailpit (1025/8025)
```

## Local dev

```bash
cp .env.example .env                 # once
pnpm install
pnpm infra:up                        # postgres, s3, mailpit
pnpm db:migrate && pnpm db:seed      # schema + sample studio/events/guests
pnpm dev                             # web :3000 + admin :3001
cd workers/media && make models && make dev   # python worker (api :8010 + consumer)
```

Sites: `http://priya-arjun.localhost:3000`, admin `http://localhost:3001` (sign in as `admin@localhost`; the magic link lands in Mailpit at `http://localhost:8025`).

## Rules that matter

- **Tenancy:** every event-owned query filters by `eventId` (and `studioId` where the column exists). Use `scoped()` from `@hub/db` or be explicit. Never return rows across events to a non-platform-admin.
- **Authorization:** only `can()` in `packages/shared/src/policy.ts` decides permissions. Server actions re-check; the UI only hides. `INVITE_LINK` sessions can never perform elevated actions.
- **Account linking:** a `Guest` is linked to a `User` only through a *verified* contact (`resolveUserForVerifiedContact` / `linkGuestsForContact`). Never auto-link on host-typed email/phone.
- **Private sites:** every event page is behind a session; sign-in responses never reveal whether an address is on the guest list.
- **Biometrics:** selfie images are never persisted. Embeddings live only in `Face`, `FaceCluster`, `FaceProfile`. `PhotoMatch` is not biometric and survives purges. Retention is admin-set (30–730 days).
- **Jobs:** Postgres `Job` table, `FOR UPDATE SKIP LOCKED`. Enqueue in the same transaction as the row that caused it. Use `dedupeKey` for coalescing.
- **Storage:** S3 API only, via `@hub/shared/storage` (TS) or `hub_worker.storage` (Python). Keys: `s/{studioId}/e/{eventId}/orig|d|site|zip/...`. Originals are never served through a public path.
- **Providers:** email/sms/print/payments are adapters; local uses SMTP→Mailpit and console SMS. No cloud resources are created from this repo.
- **i18n:** host content is `LocalizedText` JSON `{en,te,hi}`; render with `t()`. UI chrome via `ui()`.

## Commands

```bash
pnpm typecheck                       # all TS packages
pnpm test                            # policy tests etc.
pnpm --filter @hub/web build         # next build; skips the production env checks unless APP_ENV is set (docs/deploy/env.md)
pnpm lint                            # env-docs --check, then next lint
pnpm env:docs                        # regenerate .env.example + docs/deploy/env.md after editing env.ts, config.py DEFAULTS or scripts/env-meta.mjs
cd workers/media && make test        # pytest (needs local postgres)
cd packages/db && pnpm exec prisma studio
```

## Conventions

- TypeScript strict, Tailwind v3, server actions over API routes except where a browser needs a URL (downloads, face search upload).
- No emojis in UI copy. Restrained design. Mobile-first.
- Placeholders are labelled as such (Stripe, print lab, SMS provider). `ROOT_DOMAIN` is the only place the studio domain lives.
