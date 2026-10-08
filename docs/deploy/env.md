# Environment variables and secrets

Every service (web, admin, worker, Prisma) reads the same set of variables. Two parsers define them:

| Parser | File | Consumers |
|---|---|---|
| Zod schema behind `env()` | `packages/shared/src/env.ts` | apps/web, apps/admin (both validate the whole schema on first use) |
| `DEFAULTS` + `load_settings()` | `workers/media/hub_worker/config.py` | workers/media |

The reference table below and the whole of `.env.example` are **generated** from those two files plus
`scripts/env-meta.mjs` (secret?, production rule, owner, notes, example value). Do not edit either by hand.

```bash
pnpm env:docs                        # regenerate .env.example and the table below
node scripts/env-docs.mjs --check    # CI and `pnpm lint`: fails on any drift
```

`--check` fails when a key read by either parser has no metadata (and therefore no `.env.example` line),
when metadata names a key nobody reads, or when either generated file differs from what the sources produce.

## Adding a variable

1. Add it to the parser that reads it: a one-line `KEY: z...` entry in `env.ts`, and/or a `"KEY": "default"`
   entry in the worker's `DEFAULTS` (read it through `get("KEY")` in `load_settings()`).
2. Add its metadata to `scripts/env-meta.mjs` in the right section: `production`, `secret`, `owner`, `notes`,
   and `example` (a working local value; omit it to write a commented-out default).
3. Run `pnpm env:docs` and commit `.env.example` and this file with the change.
4. Copy the new line into your own `.env` if you need a non-default value locally.

## Columns

- **Read by**: `web, admin` = parsed by `env.ts`; `worker` = parsed by `config.py`; others read it directly
  (`prisma` CLI, `db` = packages/db, `seed` = prisma/seed.ts).
- **Default**: what applies when the variable is unset. When the parsers disagree, both are shown. Secret
  defaults are never printed. A blank value (`KEY=` or whitespace only) means unset everywhere (`env()`, the
  worker, the web middleware, the seed): the default applies, or a required variable is reported as missing.
  Other values are trimmed. (A blank `FACE_MATCH_THRESHOLD` is 0.363, never 0; an explicit value outside
  (0, 1] is rejected.)
- **Local**: the value in `.env.example`. Secret values are dev placeholders that only work against the local
  compose stack.
- **Production**: **required** = the local value is wrong in production and must be set deliberately;
  optional = the default is fine; planned (not read yet) = no code reads it today. A required row says
  "checked by env()" and/or "checked by worker" when startup verifies it (listed below); a required row
  without that is your responsibility and nothing will stop a bad value.
- **Secret**: a credential. Never commit it, bake it into an image, log it or paste it into an issue.

## Production validation

"Production" means `APP_ENV=production`, or, with `APP_ENV` unset or empty, `NODE_ENV=production`.
`APP_ENV` must be exactly `development`, `test` or `production`: web/admin refuse to start on anything else
(`prod` and `Production` are errors, not silent downgrades), and the worker logs a warning and ignores it.
Set `APP_ENV=production` on every service; a warning is logged once when `NODE_ENV=production` and `APP_ENV` is not.

- `env()` in web/admin throws at first use, listing every problem without echoing any value, when
  - `AUTH_SECRET` is a dev placeholder (`change-me`, `dev-only`, `ci-only`, `placeholder`), is not hex or
    base64, or decodes to fewer than 32 bytes. **This is a format and length check, not an entropy test**: it
    cannot tell a random value from `aaaa...`. Generate the value with `openssl rand -base64 32`;
  - `ROOT_DOMAIN`, `WEB_ORIGIN` or `ADMIN_ORIGIN` point at a loopback host (`localhost`, `*.localhost`,
    `127.0.0.0/8`, `::1`), including when unset or blank;
  - `WORKER_INTERNAL_URL` is not set explicitly (a loopback address is accepted for a single-host deploy);
  - `S3_PUBLIC_ENDPOINT` is unset;
  - `S3_ACCESS_KEY` or `S3_SECRET_KEY` is the local development key;
  - `EMAIL_PROVIDER` is `console` (the default).
- The worker's `load_settings()` stays free of side effects; `python -m hub_worker` logs one warning per
  production-required setting (`DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) that
  is unset, empty or still equal to its local default.
- `SMS_PROVIDER` is not checked yet: only `console` exists. The rule arrives with real providers (SHR-011,
  check in SHR-017).
- Not checked by anything today, though marked required: `DATABASE_URL` (web/admin; Zod only requires it to be
  set), `SMTP_HOST`, `EMAIL_FROM`.

### `next build`

`next build` runs with `NODE_ENV=production` and whatever `.env` is on the machine. To keep a local or CI build
from tripping the production checks, `env()` skips them (and the `APP_ENV` warning) while Next sets
`NEXT_PHASE=phase-production-build` **and `APP_ENV` is unset**. A build with `APP_ENV=production` is a production
build and is checked in full, so a prerendered page can never bake a localhost value into the artifact. Malformed
variables (a bad `APP_ENV`, a missing `DATABASE_URL`) are always reported, and the production checks apply in full
the first time a running server calls `env()`.

Today nothing calls `env()` while the apps build (pages are `force-dynamic` and `env()` is lazy), so a build
with the dev `.env` passes regardless; CI runs `next build` for both apps with the CI environment to keep it
that way. To smoke-test a production build locally with the dev `.env`, start it with `APP_ENV=development`
(`APP_ENV=development pnpm --filter @hub/web start`).

## Reference

<!-- env-docs:begin (generated by scripts/env-docs.mjs; edit scripts/env-meta.mjs) -->

47 variables. Read by: web/admin = `packages/shared/src/env.ts` (Zod), worker = `workers/media/hub_worker/config.py` (DEFAULTS).

### Runtime

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | web, admin, worker | web/admin: `development`; worker: unset | commented out (default applies) | optional | no | Set by Next (`next build` / `next start`) | Do not set it in `.env`; Next sets it. It is the fallback when APP_ENV is unset: `production` turns the production checks on. An empty value counts as unset; anything other than `development`, `test` or `production` stops web/admin and makes the worker warn. |
| `APP_ENV` | web, admin, worker | unset | commented out (default applies) | **required** | no | Deploy config (DOC-006) | Set `production` on every service, including the worker (which has no NODE_ENV). Wins over NODE_ENV: `production` turns on the production checks, `development` lets you `next start` locally with the dev `.env`. Must be exactly `development`, `test` or `production` (an empty value counts as unset): web/admin refuse to start on anything else, the worker warns and ignores it. A warning is logged when NODE_ENV=production and APP_ENV is not `production`. |

### Domains

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `ROOT_DOMAIN` | web, admin, seed | `localhost` | `localhost` | **required** · checked by env() | no | INF-019 (domain, wildcard DNS, TLS) | Event sites live at `{slug}.ROOT_DOMAIN`; also the session cookie domain. `localhost` locally; env() rejects a loopback value in production. |
| `WEB_PORT` | web, admin, seed | `3000` | `3000` | optional | no | Local dev only | Appended to event-site origins only when ROOT_DOMAIN is `localhost`. |
| `ADMIN_PORT` | web, admin, seed | `3001` | `3001` | optional | no | Local dev only | Admin dev port. |
| `WEB_ORIGIN` | web, admin | `http://localhost:3000` | `http://localhost:3000` | **required** · checked by env() | no | INF-019 | Absolute guest-site origin used in links (emails, redirects). env() rejects a loopback origin in production. |
| `ADMIN_ORIGIN` | web, admin | `http://localhost:3001` | `http://localhost:3001` | **required** · checked by env() | no | INF-019 | Absolute admin origin used in sign-in links and redirects. env() rejects a loopback origin in production. |

### Postgres

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | web, admin, worker, prisma | web/admin: none: must be set; worker: local dev value (masked) | dev placeholder | **required** · checked by worker | secret | Managed Postgres with pgvector (DOC-006); platform secret store | Contains the database password. Locally the compose Postgres on :5433. |
| `PRISMA_LOG` | db | unset | commented out (default applies) | optional | no | Debugging only | Any non-empty value logs every query (packages/db). Leave unset in production. |

### Object storage

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `S3_ENDPOINT` | web, admin, worker | web/admin: none: must be set; worker: `http://localhost:9000` | `http://localhost:9000` | **required** · checked by worker | no | Bucket provider (DOC-006) | Server-side S3 API endpoint. Locally RustFS on :9000. |
| `S3_PUBLIC_ENDPOINT` | web, admin | unset | `http://localhost:9000` | **required** · checked by env() | no | Bucket provider / CDN domain (DOC-006) | Browser-facing endpoint for presigned URLs. Falls back to S3_ENDPOINT locally; env() rejects production without it. |
| `S3_REGION` | web, admin, worker | `us-east-1` | `us-east-1` | optional | no | Bucket provider | `auto` for R2. |
| `S3_BUCKET` | web, admin, worker | web/admin: none: must be set; worker: `hub-media` | `hub-media` | **required** · checked by worker | no | Bucket provider (DOC-006) | Single bucket; keys are tenant-prefixed (`s/{studioId}/e/{eventId}/...`). |
| `S3_ACCESS_KEY` | web, admin, worker | web/admin: none: must be set; worker: local dev value (masked) | dev placeholder | **required** · checked by env(), worker | secret | Bucket provider API token; platform secret store | Local values match the RustFS credentials in infra/docker-compose.yml; env() rejects them in production. |
| `S3_SECRET_KEY` | web, admin, worker | web/admin: none: must be set; worker: local dev value (masked) | dev placeholder | **required** · checked by env(), worker | secret | Bucket provider API token; platform secret store | Rotate with S3_ACCESS_KEY (see Rotation). |
| `S3_FORCE_PATH_STYLE` | web, admin, worker | `true` | `true` | optional | no | Bucket provider | `true` for RustFS/MinIO; R2 and S3 accept either. Accepts true/false, 1/0, yes/no, on/off (case-insensitive) in both web/admin and the worker; anything else is an error. Empty counts as unset. |

### Email

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `EMAIL_PROVIDER` | web, admin | `console` | `smtp` | **required** · checked by env() | no | SHR-012 (email provider) | `console` (the default) only logs mail; `smtp` sends via SMTP_HOST. env() rejects `console` in production. |
| `SMTP_HOST` | web, admin | `localhost` | `localhost` | **required** | no | SHR-012 (email provider) | Unauthenticated, non-TLS transport today; provider auth arrives with SHR-012. |
| `SMTP_PORT` | web, admin | `1025` | `1025` | optional | no | SHR-012 (email provider) | Mailpit listens on 1025. |
| `EMAIL_FROM` | web, admin | `Event Hub <hello@localhost>` | `"Event Hub <hello@localhost>"` | **required** | no | DOC-002 (email domain authentication) | Sender address; its domain needs SPF/DKIM/DMARC in production. |

### SMS

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `SMS_PROVIDER` | web, admin | `console` | `console` | optional | no | SHR-011 (Twilio/Telnyx adapter), INF-011 (10DLC) | Only `console` exists (logs to stdout). Production SMS needs SHR-011 and an approved 10DLC campaign; its production check is SHR-017. |

### Auth

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `AUTH_SECRET` | web, admin | none: must be set | dev placeholder | **required** · checked by env() | secret | Platform secret store; generate with `openssl rand -base64 32` | HMAC key that signs the session cookie, salts IP hashes in face-search records and keys the rate-limit counters (rotating it also resets every rate-limit window). In production env() requires hex or base64 that decodes to at least 32 bytes and rejects dev placeholders; that is a format and length check, it cannot measure entropy, so generate it with a CSPRNG. Rotating it signs everyone out until dual-key support (SHR-018) lands (see Rotation). |
| `SESSION_TTL_DAYS` | web, admin | `30` | `30` | optional | no | Product decision | Lifetime of a verified sign-in session. |
| `INVITE_SESSION_TTL_DAYS` | web, admin | `90` | `90` | optional | no | Product decision | Max lifetime of an invitation-link session (INVITE_LINK scope); it also ends when the link itself expires (event end + 90 days, packages/shared/src/invites.ts). |

### Rate limits

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `TRUSTED_PROXY_HOPS` | web, admin | `1` | commented out (default applies) | optional | no | Deploy topology (DOC-006) | How many proxies in front of web/admin APPEND to X-Forwarded-For (Fly, Cloud Run, Render, ALB, Railway each append one). The client IP for per-IP limits and face-search ipHash is the Nth valid entry from the right; entries further left are client-written and ignored. Too high lets clients choose their IP; too low makes every request look like the proxy. Without the header, production uses one shared bucket and development skips per-IP limits. |
| `RATE_LIMIT_SIGN_IN_IP` | web, admin | derived: `60/900` | commented out (default applies) | optional | no | Product decision (SHR-003) | Guest sign-in requests per client IP. Raise it for very large events on one venue network. |
| `RATE_LIMIT_SIGN_IN_ADDRESS_IP` | web, admin | derived: `5/900` | commented out (default applies) | optional | no | Product decision (SHR-003) | Guest sign-in requests per (address, client IP): the strict limit, keyed on the pair so a stranger elsewhere cannot use up a guest's attempts. |
| `RATE_LIMIT_SIGN_IN_ADDRESS` | web, admin | derived: `20/900` | commented out (default applies) | optional | no | Product decision (SHR-003) | Guest sign-in requests per address from any IP; bounds an attacker who rotates IPs (who can still delay one address for up to the window: the accepted residual). |
| `RATE_LIMIT_OTP_VERIFY_ADDRESS` | web, admin | derived: `10/900` | commented out (default applies) | optional | no | Product decision (SHR-003); applied by SHR-027 | OTP code checks per address. Defined now; nothing reads it until the OTP verify step lands (SHR-027). |
| `RATE_LIMIT_INVITE_IP` | web, admin | derived: `200/3600` | commented out (default applies) | optional | no | Product decision (SHR-003) | Invitation-link hits per client IP, counted before the token lookup; over the limit the answer is a localized 429. |
| `RATE_LIMIT_FACE_SEARCH_USER` | web, admin | derived: `10/3600` | commented out (default applies) | optional | no | Product decision (SHR-003) | Selfie searches per signed-in user; over the limit face search answers 429 `rate_limited`. |
| `RATE_LIMIT_FACE_SEARCH_CONCURRENT` | web, admin | derived: `3/60` | commented out (default applies) | optional | no | Product decision (SHR-003) | Face searches in flight per user (max) and the lease TTL in seconds that frees slots held by a crashed request. |
| `RATE_LIMIT_ADMIN_MAGIC_LINK_IP` | web, admin | derived: `60/900` | commented out (default applies) | optional | no | Product decision (SHR-003) | Admin sign-in link requests per client IP. |
| `RATE_LIMIT_ADMIN_MAGIC_LINK_ADDRESS_IP` | web, admin | derived: `5/900` | commented out (default applies) | optional | no | Product decision (SHR-003) | Admin sign-in link requests per (address, client IP). |
| `RATE_LIMIT_ADMIN_MAGIC_LINK_ADDRESS` | web, admin | derived: `20/900` | commented out (default applies) | optional | no | Product decision (SHR-003) | Admin sign-in link requests per address from any IP. |

### Worker

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `WORKER_INTERNAL_URL` | web, admin | `http://localhost:8010` | `http://localhost:8010` | **required** · checked by env() | no | Deploy topology (DOC-006) | Where web calls the worker API (`/embed-selfie`). Private network only; never public. env() requires it to be set explicitly in production (a loopback address is allowed for a single-host deploy). |
| `WORKER_PORT` | worker | `8010` | `8010` | optional | no | Deploy topology | Worker FastAPI port. |
| `FACE_MODEL_DIR` | worker | `./models` | `./models` | optional | no | Worker image (`make models`) | Relative paths resolve against workers/media. |
| `FACE_MATCH_THRESHOLD` | web, admin, worker | `0.363` | `0.363` | optional | no | Face pipeline tuning | SFace cosine similarity for a match. web and worker must agree. Must be greater than 0 and at most 1 in both (a value <= 0 would match every face); anything else fails at startup. |
| `FACE_CLUSTER_DISTANCE` | worker | derived: 1 − FACE_MATCH_THRESHOLD | commented out (default applies) | optional | no | Face pipeline tuning | Agglomerative clustering cutoff in cosine distance. |
| `FACE_MIN_QUALITY` | worker | `0.3` | commented out (default applies) | optional | no | Face pipeline tuning | Faces below this quality score are not indexed. |
| `WORKER_ID` | worker | derived: `<hostname>:<pid>` | commented out (default applies) | optional | no | Deploy topology | Job lock owner id. Set only to pin a stable id per replica. |
| `WORKER_POLL_INTERVAL` | worker | `1.0` | commented out (default applies) | optional | no | Worker tuning | Seconds between polls of an empty job queue. |
| `ZIP_PART_BYTES` | worker | `2147483648` | commented out (default applies) | optional | no | Worker tuning | Maximum size of one gallery ZIP part (2 GiB). |
| `WORKER_LOG_LEVEL` | worker | `INFO` | commented out (default applies) | optional | no | Observability | Python logging level. |

### Payments

| Variable | Read by | Default | Local (`.env.example`) | Production | Secret | Source / owner | Notes |
|---|---|---|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | nobody yet | not read yet (INF-008) | dev placeholder | planned (not read yet) | secret | INF-009 (Stripe account); platform secret store | Nothing reads this yet; it is only a placeholder in `.env.example`, so leave it as is until INF-008 lands. Once code reads it, no Stripe call may happen unless it starts with `sk_`. |
| `STRIPE_WEBHOOK_SECRET` | nobody yet | not read yet (INF-008) | dev placeholder | planned (not read yet) | secret | INF-009 (Stripe webhook endpoint); platform secret store | Nothing reads this yet; placeholder only. Once code reads it, it is the signing secret for the Stripe webhook endpoint. |

<!-- env-docs:end -->

## Handling secrets

- **Never in images.** Dockerfiles must not `COPY .env*`; keep `.env*` (except `.env.example`) in
  `.dockerignore`. Images are configured entirely at runtime.
- **Inject at runtime** from the platform's secret store (choice per provider in DOC-006), or on a single host
  from `.env.production` owned by the service user with `chmod 600`, outside the repository checkout.
- **Never commit** a real value. `.env` is gitignored; `.env.example` and this page hold placeholders only.
  CI uses throwaway values (`AUTH_SECRET: ci-only-...`) that `env()` would reject in production.
- **Never log** a secret. `env()` errors name the variable and the rule, not the value; keep it that way in new
  checks (`productionIssues()` in `env.ts`, `production_warnings()` in `config.py`).
- **Least privilege.** The S3 key needs only the one bucket; the database user needs only the app database.
- **Generate** secrets with a CSPRNG: `openssl rand -base64 32`.

## Rotation

Rotate on a schedule, and immediately when a value may have leaked (log, screenshot, former staff, laptop loss).

### `AUTH_SECRET`

It signs the `hub_session` cookie and salts IP hashes. Only one key is accepted today, so rotating it
**signs every user out** (cookies fail verification; sessions in the database are untouched and expire on
their own). Magic-link and invite tokens are stored as plain SHA-256 hashes and keep working.

1. Generate a new value; store it in the secret store.
2. Restart web and admin together (they must agree).
3. Expect a wave of sign-ins; IP hashes recorded after the change no longer match earlier ones.

Dual-key support (`AUTH_SECRET_PREVIOUS` accepted for verification during a grace period, so rotation does not
sign anyone out) is tracked in SHR-018.

### `INTERNAL_API_TOKEN` (arrives with SHR-005)

Shared by admin (verifies) and worker (sends). With a single token, update the secret store, then restart admin
and the worker back to back; jobs that hit a 401 in between fail and are retried with backoff, so nothing is
lost. Never expose the internal endpoint publicly, whatever the token.

### S3 keys (`S3_ACCESS_KEY`, `S3_SECRET_KEY`)

1. Create a second key pair at the bucket provider with the same bucket-scoped permissions.
2. Update both values in the secret store; restart web, admin and the worker.
3. Verify an upload, a download and one worker job (derivatives) succeed.
4. Revoke the old key pair. Presigned URLs signed with the old key stop working at that moment.

### Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; arrive with INF-008/SHR-009)

- API key: roll it in the Stripe dashboard with an expiry window for the old key, update the secret store,
  restart, confirm a test-mode checkout, then let the old key expire.
- Webhook secret: roll the endpoint's signing secret in the dashboard (Stripe keeps the old one valid for a
  configurable window), update the secret store, restart, confirm `stripe events resend` of a recent event
  verifies.

### Database password (`DATABASE_URL`)

Create the new password (or a second role), update `DATABASE_URL` in the secret store, restart every service and
any migration job, then revoke the old credential.
