// Metadata for every environment variable, read by scripts/env-docs.mjs.
//
// The variables themselves (names and defaults) come from the parsers:
//   packages/shared/src/env.ts        Zod schema   -> consumers "web, admin"
//   workers/media/hub_worker/config.py  DEFAULTS     -> consumer  "worker"
// This file only adds what the code cannot say: secret?, production rule, where the value comes from,
// notes, and the line written to .env.example. `node scripts/env-docs.mjs --check` fails when a parsed
// key has no entry here, or an entry here is read by nobody (unless `readBy` or `planned` says why).
//
// Fields
//   production  "required" (must be set deliberately; the local value is wrong in production)
//               "optional" (the default is fine) | "planned" (not read yet; see `planned`)
//   check       for "required" vars that startup actually verifies: "env()" (web/admin, productionIssues()
//               in env.ts), "worker" (PRODUCTION_REQUIRED in config.py) or "env(), worker". A test
//               cross-checks this against both files; omit it for rows nothing enforces.
//   secret      true when the value is a credential. Docs never print secret values.
//   owner       where the production value comes from (ticket ids: INF-019 DNS, INF-009 Stripe, ...)
//   notes       one or two sentences for docs/deploy/env.md
//   example     value written to .env.example (a working local value). Omit to write a commented
//               `# KEY=<default>` line, i.e. "unset; the default applies".
//   hint        optional comment line (or array of lines) written above the key in .env.example
//   readBy      consumers outside the two parsers (prisma, seed, db)
//   planned     ticket that will start reading the variable
//   derived     how the default is computed when the parser has no literal

/** @type {{ title: string, intro?: string[], vars: Record<string, any> }[]} */
export const SECTIONS = [
  {
    title: "Runtime",
    vars: {
      NODE_ENV: {
        production: "optional",
        owner: "Set by Next (`next build` / `next start`)",
        notes: "Do not set it in `.env`; Next sets it. It is the fallback when APP_ENV is unset: `production` turns the production checks on. An empty value counts as unset; anything other than `development`, `test` or `production` stops web/admin and makes the worker warn.",
      },
      APP_ENV: {
        production: "required",
        owner: "Deploy config (DOC-006)",
        notes: "Set `production` on every service, including the worker (which has no NODE_ENV). Wins over NODE_ENV: `production` turns on the production checks, `development` lets you `next start` locally with the dev `.env`. Must be exactly `development`, `test` or `production` (an empty value counts as unset): web/admin refuse to start on anything else, the worker warns and ignores it. A warning is logged when NODE_ENV=production and APP_ENV is not `production`.",
      },
    },
  },
  {
    title: "Domains",
    intro: ["Local: *.localhost resolves to 127.0.0.1 in Chrome/Safari/Firefox without /etc/hosts."],
    vars: {
      ROOT_DOMAIN: {
        production: "required",
        check: "env()",
        readBy: ["seed"],
        owner: "INF-019 (domain, wildcard DNS, TLS)",
        notes: "Event sites live at `{slug}.ROOT_DOMAIN`; also the session cookie domain. `localhost` locally; env() rejects a loopback value in production.",
        example: "localhost",
      },
      WEB_PORT: {
        production: "optional",
        readBy: ["seed"],
        owner: "Local dev only",
        notes: "Appended to event-site origins only when ROOT_DOMAIN is `localhost`.",
        example: "3000",
      },
      ADMIN_PORT: {
        production: "optional",
        readBy: ["seed"],
        owner: "Local dev only",
        notes: "Admin dev port.",
        example: "3001",
      },
      WEB_ORIGIN: {
        production: "required",
        check: "env()",
        owner: "INF-019",
        notes: "Absolute guest-site origin used in links (emails, redirects). env() rejects a loopback origin in production.",
        hint: "Full origins (used for links in emails)",
        example: "http://localhost:3000",
      },
      ADMIN_ORIGIN: {
        production: "required",
        check: "env()",
        owner: "INF-019",
        notes: "Absolute admin origin used in sign-in links and redirects. env() rejects a loopback origin in production.",
        example: "http://localhost:3001",
      },
    },
  },
  {
    title: "Postgres",
    intro: ["docker compose: infra/docker-compose.yml"],
    vars: {
      DATABASE_URL: {
        production: "required",
        check: "worker",
        secret: true,
        readBy: ["prisma"],
        owner: "Managed Postgres with pgvector (DOC-006); platform secret store",
        notes: "Contains the database password. Locally the compose Postgres on :5433.",
        example: "postgresql://hub:hub@localhost:5433/hub",
      },
      PRISMA_LOG: {
        production: "optional",
        readBy: ["db"],
        owner: "Debugging only",
        notes: "Any non-empty value logs every query (packages/db). Leave unset in production.",
      },
    },
  },
  {
    title: "Object storage",
    intro: ["RustFS locally; any S3-compatible store in production (R2, S3, B2)."],
    vars: {
      S3_ENDPOINT: {
        production: "required",
        check: "worker",
        owner: "Bucket provider (DOC-006)",
        notes: "Server-side S3 API endpoint. Locally RustFS on :9000.",
        example: "http://localhost:9000",
      },
      S3_PUBLIC_ENDPOINT: {
        production: "required",
        check: "env()",
        owner: "Bucket provider / CDN domain (DOC-006)",
        notes: "Browser-facing endpoint for presigned URLs. Falls back to S3_ENDPOINT locally; env() rejects production without it.",
        example: "http://localhost:9000",
      },
      S3_REGION: {
        production: "optional",
        owner: "Bucket provider",
        notes: "`auto` for R2.",
        example: "us-east-1",
      },
      S3_BUCKET: {
        production: "required",
        check: "worker",
        owner: "Bucket provider (DOC-006)",
        notes: "Single bucket; keys are tenant-prefixed (`s/{studioId}/e/{eventId}/...`).",
        example: "hub-media",
      },
      S3_ACCESS_KEY: {
        production: "required",
        check: "env(), worker",
        secret: true,
        owner: "Bucket provider API token; platform secret store",
        notes: "Local values match the RustFS credentials in infra/docker-compose.yml; env() rejects them in production.",
        example: "minio",
      },
      S3_SECRET_KEY: {
        production: "required",
        check: "env(), worker",
        secret: true,
        owner: "Bucket provider API token; platform secret store",
        notes: "Rotate with S3_ACCESS_KEY (see Rotation).",
        example: "minio12345",
      },
      S3_FORCE_PATH_STYLE: {
        production: "optional",
        owner: "Bucket provider",
        notes: "`true` for RustFS/MinIO; R2 and S3 accept either. Accepts true/false, 1/0, yes/no, on/off (case-insensitive) in both web/admin and the worker; anything else is an error. Empty counts as unset.",
        example: "true",
      },
    },
  },
  {
    title: "Email",
    intro: ["Mailpit locally: UI at http://localhost:8025"],
    vars: {
      EMAIL_PROVIDER: {
        production: "required",
        check: "env()",
        owner: "SHR-012 (email provider)",
        notes: "`console` (the default) only logs mail; `smtp` sends via SMTP_HOST. env() rejects `console` in production.",
        example: "smtp",
      },
      SMTP_HOST: {
        production: "required",
        owner: "SHR-012 (email provider)",
        notes: "Unauthenticated, non-TLS transport today; provider auth arrives with SHR-012.",
        example: "localhost",
      },
      SMTP_PORT: {
        production: "optional",
        owner: "SHR-012 (email provider)",
        notes: "Mailpit listens on 1025.",
        example: "1025",
      },
      EMAIL_FROM: {
        production: "required",
        owner: "DOC-002 (email domain authentication)",
        notes: "Sender address; its domain needs SPF/DKIM/DMARC in production.",
        example: '"Event Hub <hello@localhost>"',
      },
    },
  },
  {
    title: "SMS",
    vars: {
      SMS_PROVIDER: {
        production: "optional",
        owner: "SHR-011 (Twilio/Telnyx adapter), INF-011 (10DLC)",
        notes: "Only `console` exists (logs to stdout). Production SMS needs SHR-011 and an approved 10DLC campaign; its production check is SHR-017.",
        hint: "console provider logs to stdout; real providers arrive with SHR-011",
        example: "console",
      },
    },
  },
  {
    title: "Auth",
    vars: {
      AUTH_SECRET: {
        production: "required",
        check: "env()",
        secret: true,
        owner: "Platform secret store; generate with `openssl rand -base64 32`",
        notes: "HMAC key that signs the session cookie, salts IP hashes in face-search records and keys the rate-limit counters (rotating it also resets every rate-limit window). In production env() requires hex or base64 that decodes to at least 32 bytes and rejects dev placeholders; that is a format and length check, it cannot measure entropy, so generate it with a CSPRNG. Rotating it signs everyone out until dual-key support (SHR-018) lands (see Rotation).",
        example: "dev-only-change-me-0123456789abcdef",
      },
      SESSION_TTL_DAYS: {
        production: "optional",
        owner: "Product decision",
        notes: "Lifetime of a verified sign-in session.",
        example: "30",
      },
      INVITE_SESSION_TTL_DAYS: {
        production: "optional",
        owner: "Product decision",
        notes: "Max lifetime of an invitation-link session (INVITE_LINK scope); it also ends when the link itself expires (event end + 90 days, packages/shared/src/invites.ts).",
        hint: [
          "Max lifetime of a session opened from an invitation link; it also ends when the link",
          "itself expires (event end + 90 days, packages/shared/src/invites.ts).",
        ],
        example: "90",
      },
    },
  },
  {
    title: "Rate limits",
    intro: [
      "packages/shared/src/ratePolicies.ts; docs/01 §9. Overrides are max/windowSec (1..1000000 / 1..604800),",
      "checked when web/admin start: a bad value logs the reason and the process exits with code 1 (`next start`; `next dev` stops before Ready). Per-IP limits are loose on purpose (venue",
      "Wi-Fi, carrier NAT); the per-address limits are the real control.",
    ],
    vars: {
      TRUSTED_PROXY_HOPS: {
        production: "optional",
        owner: "Deploy topology (DOC-006)",
        notes: "How many entries the proxies in front of web/admin APPEND to X-Forwarded-For. This varies by platform (GCP's external Application Load Balancer appends two, for example), so the deploy (DOC-006) must check it: send a request with `X-Forwarded-For: 198.51.100.1` and log the header the app receives; the real client must sit exactly N entries from the right. The client IP for per-IP limits and face-search ipHash is the Nth entry from the right; entries further left are client-written and ignored, and a non-IP at that position (`unknown`, `unix:`) maps to one shared bucket. Too high lets clients choose their IP; too low makes every request look like the proxy. Per-IP limits are skipped only when APP_ENV (else NODE_ENV) is `development` or `test`.",
        hint: "Number of X-Forwarded-For entries your proxies append; the client is that many entries from the right.",
      },
      RATE_LIMIT_SIGN_IN_IP: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`60/900`",
        notes: "Guest sign-in requests per client IP. Raise it for very large events on one venue network.",
        hint: "Guest sign-in: per IP, per (address, IP), per address. Over the limit the reply is unchanged and nothing is sent.",
      },
      RATE_LIMIT_SIGN_IN_ADDRESS_IP: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`5/900`",
        notes: "Guest sign-in requests per (address, client IP): the strict limit, keyed on the pair so a stranger elsewhere cannot use up a guest's attempts.",
      },
      RATE_LIMIT_SIGN_IN_ADDRESS: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`20/900`",
        notes: "Guest sign-in requests per address from any IP; bounds an attacker who rotates IPs (who can still delay one address for up to the window: the accepted residual).",
      },
      RATE_LIMIT_OTP_VERIFY_ADDRESS: {
        production: "optional",
        owner: "Product decision (SHR-003); applied by SHR-027",
        derived: "`10/900`",
        notes: "OTP code checks per address. Defined now; nothing reads it until the OTP verify step lands (SHR-027).",
      },
      RATE_LIMIT_INVITE_IP: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`200/3600`",
        notes: "Invitation-link hits per client IP, counted before the token lookup; over the limit the answer is a localized 429.",
      },
      RATE_LIMIT_FACE_SEARCH_USER: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`10/3600`",
        notes: "Selfie searches per signed-in user; over the limit face search answers 429 `rate_limited`.",
      },
      RATE_LIMIT_FACE_SEARCH_CONCURRENT: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`3/60`",
        notes: "Face searches in flight per user (max) and the lease TTL in seconds that frees slots held by a crashed request.",
      },
      RATE_LIMIT_ADMIN_MAGIC_LINK_IP: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`60/900`",
        notes: "Admin sign-in link requests per client IP.",
        hint: "Admin magic link: per IP, per (address, IP), per address.",
      },
      RATE_LIMIT_ADMIN_MAGIC_LINK_ADDRESS_IP: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`5/900`",
        notes: "Admin sign-in link requests per (address, client IP).",
      },
      RATE_LIMIT_ADMIN_MAGIC_LINK_ADDRESS: {
        production: "optional",
        owner: "Product decision (SHR-003)",
        derived: "`20/900`",
        notes: "Admin sign-in link requests per address from any IP.",
      },
    },
  },
  {
    title: "Worker",
    vars: {
      WORKER_INTERNAL_URL: {
        production: "required",
        check: "env()",
        owner: "Deploy topology (DOC-006)",
        notes: "Where web calls the worker API (`/embed-selfie`). Private network only; never public. env() requires it to be set explicitly in production (a loopback address is allowed for a single-host deploy).",
        example: "http://localhost:8010",
      },
      WORKER_PORT: {
        production: "optional",
        owner: "Deploy topology",
        notes: "Worker FastAPI port.",
        example: "8010",
      },
      FACE_MODEL_DIR: {
        production: "optional",
        owner: "Worker image (`make models`)",
        notes: "Relative paths resolve against workers/media.",
        example: "./models",
      },
      FACE_MATCH_THRESHOLD: {
        production: "optional",
        owner: "Face pipeline tuning",
        notes: "SFace cosine similarity for a match. web and worker must agree. Must be greater than 0 and at most 1 in both (a value <= 0 would match every face); anything else fails at startup.",
        hint: "SFace cosine; OpenCV's recommended default",
        example: "0.363",
      },
      FACE_CLUSTER_DISTANCE: {
        production: "optional",
        owner: "Face pipeline tuning",
        derived: "1 − FACE_MATCH_THRESHOLD",
        notes: "Agglomerative clustering cutoff in cosine distance.",
      },
      FACE_MIN_QUALITY: {
        production: "optional",
        owner: "Face pipeline tuning",
        notes: "Faces below this quality score are not indexed.",
      },
      WORKER_ID: {
        production: "optional",
        owner: "Deploy topology",
        derived: "`<hostname>:<pid>`",
        notes: "Job lock owner id. Set only to pin a stable id per replica.",
      },
      WORKER_POLL_INTERVAL: {
        production: "optional",
        owner: "Worker tuning",
        notes: "Seconds between polls of an empty job queue.",
      },
      ZIP_PART_BYTES: {
        production: "optional",
        owner: "Worker tuning",
        notes: "Maximum size of one gallery ZIP part (2 GiB).",
      },
      WORKER_LOG_LEVEL: {
        production: "optional",
        owner: "Observability",
        notes: "Python logging level.",
      },
    },
  },
  {
    title: "Payments",
    intro: ["Placeholders; no Stripe calls are made locally."],
    vars: {
      STRIPE_SECRET_KEY: {
        production: "planned",
        secret: true,
        planned: "INF-008",
        owner: "INF-009 (Stripe account); platform secret store",
        notes: "Nothing reads this yet; it is only a placeholder in `.env.example`, so leave it as is until INF-008 lands. Once code reads it, no Stripe call may happen unless it starts with `sk_`.",
        example: "sk_test_placeholder",
      },
      STRIPE_WEBHOOK_SECRET: {
        production: "planned",
        secret: true,
        planned: "INF-008",
        owner: "INF-009 (Stripe webhook endpoint); platform secret store",
        notes: "Nothing reads this yet; placeholder only. Once code reads it, it is the signing secret for the Stripe webhook endpoint.",
        example: "whsec_placeholder",
      },
    },
  },
];
