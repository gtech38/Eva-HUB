# Claude Code skills for Event & Photo Delivery Hub

Each folder holds one `SKILL.md` with frontmatter (`name` = folder, `description` = when to load it). Skills are repo-specific: real paths, real commands, observed conventions. Load the one that matches the files or task in front of you; most tasks need two or three. `tdd-workflow` and `solid-design` apply to every change.

| Skill | One line | Load when |
|---|---|---|
| `tdd-workflow` | Red-green-refactor rules enforced by `.claude/hooks`; where tests live per language; `pnpm verify` | Any code change (always) |
| `solid-design` | Boundaries to respect: adapters, `can()`, `scoped()`, one visibility function, handler shape | Designing or reviewing structure (always) |
| `pnpm-monorepo` | Workspace layout, `workspace:*`, TS-source packages with `.ts` imports, `transpilePackages`, root scripts, exFAT `._*` quirks | Adding packages/deps, resolution or typecheck errors, root scripts |
| `nextjs-app-router` | Next 15 + React 19 patterns: hostname middleware and `/sites/[slug]` rewrite, `force-dynamic`, `authorize()`/`act()` actions, route handlers, sessions, `revalidatePath`, client/server imports | Any page, layout, action or route in `apps/web` or `apps/admin` |
| `prisma-postgres` | `packages/db`: schema conventions, migrations (incl. raw SQL CHECK/RLS), `$queryRaw` quoting and enum casts, pgvector literals, `Job`/`enqueue()` dedupe, `scoped()`, Prisma Studio | Schema, migration, raw SQL, jobs, seed/reset |
| `tailwind-themes` | Theme tokens -> Tailwind semantic classes, `Shell/Hero/Divider` contract, fonts with Noto fallbacks, adding a theme, admin CSS utilities, visual check in te/hi | Styling, themes, fonts, Indic rendering |
| `auth-sessions-policy` | `hub_session` HMAC cookie, tokens stored hashed, `INVITE_LINK` scope, guest-to-user linking on verified contacts only, `can()` matrix + tests, 12 h re-auth, enumeration-safe sign-in | Sign-in, sessions, invites, permissions, new `Action` |
| `i18n-localized-content` | `t()/ui()/UI`, `hub_lang` cookie and `?lang=`, Zod page schemas and `parsePage`, admin `LocalizedInputs`/`PageEditor`, UCS-2 SMS segments | Any user-visible text, page content fields, locale behaviour |
| `s3-object-storage` | Key layout `s/{studioId}/e/{eventId}/...`, presign upload/download, `derivativeUrl`, public vs internal endpoint, RustFS locally and CORS fallback proxy, provider switch by env, bucket inspection | Uploads, downloads, derivatives, zips, bucket config |
| `python-media-worker` | `workers/media`: Makefile, `config.py`, consumer semantics (SKIP LOCKED, backoff, DEAD, dedupe, stale locks, `Requeue`), handlers, adding a job type on both sides, Pillow derivatives, pytest layout | Worker code, job behaviour, derivative changes |
| `face-recognition-pipeline` | YuNet+SFace models and licences, 128-d embeddings, thresholds, bbox/quality, SQL match, `PhotoMatch`/`BiometricConsent`/`FaceProfile` writes, privacy and purge rules, bench script | Face search, clustering, consent, retention |
| `docker-local-infra` | `infra/docker-compose.yml` services/ports/creds, `infra:up|down|nuke`, RustFS not MinIO, Mailpit API, psql access, reset flow, Docker Desktop and image-pull failures | Local stack problems, resets, reading emails |
| `email-sms-adapters` | `email()`/`sms()` adapters and env switch, `Message` rows and statuses, invitation/resend/reminder flows, `InviteToken` lifecycle, adding a provider + webhook, 10DLC/STOP obligations | Sending or tracking messages, new provider |
| `payments-stripe-placeholder` | What exists (price sheets, orders, entitlements, comped unlock), entitlement checks in `lib/gallery.ts`, planned Stripe Connect flow, local test mode with `stripe listen`, never calling Stripe with the placeholder key | Commerce models, entitlements, starting Stripe |
| `observability-logging` | Current console/Python logging and `AuditLog` conventions and action names, admin Jobs/Audit pages, health endpoints, planned pino + OTel + Sentry with request/tenant context | Adding logs/audit/health, debugging across services |
| `admin-app-patterns` | `requireAdmin()`, `authorize()`+`act()`, form helpers and `EmailSchema`, studio/event layout structure, `ui.tsx`/`forms.tsx`, smoke scripts and minting a session, adding an admin page with a test | Any work in `apps/admin` |
| `guest-site-patterns` | `getSite()/requireViewer()`, sign-in gate, `lib/gallery.ts` visibility + entitlement, RSVP/favorites actions, download/face routes, themed components, adding a guest page (Registry) with a test | Any work in `apps/web/src/app/sites` |
| `github-backlog-workflow` | Ticket file format, `pnpm backlog:sync`, labels/milestones, picking `agent-ready` issues, branch `<id>/<slug>`, PR `"<ID>: title"` + `Closes #n`, `pnpm verify` before PR, gh cheat sheet | Starting/finishing a ticket, writing tickets |
| `e2e-playwright` | Plan and conventions for browser tests (Playwright not installed yet): local stack, Mailpit sign-in, seeded fixtures, test ids, theme x locale screenshots, test locations, CI shape | Planning or adding e2e coverage |

## Conventions for editing skills
- Keep each `SKILL.md` between 80 and 250 lines; tables and command blocks over prose; no emojis.
- Sections in order: When this applies, Where things live, Conventions in this repo, Common tasks (each with the test to write first), Gotchas, Verification, References.
- When code and `docs/` disagree, the skill states what the code does and names the doc section that is out of date.
- Frontmatter check: every `*/SKILL.md` starts with `---`, has `name:` equal to its folder and a `description:`.
