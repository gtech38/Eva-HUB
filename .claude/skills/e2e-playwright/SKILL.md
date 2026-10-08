---
name: e2e-playwright
description: Use when planning or writing end-to-end browser tests for the guest site or admin. Playwright is NOT installed yet (it appears in pnpm-lock.yaml only as an optional peer of next); this skill is the agreed plan and conventions: run against the local compose stack, sign in by reading the magic link from Mailpit's API, fixtures for seeded users, data-testid rules, screenshots for 3 themes x 3 locales, test locations (apps/web/e2e, apps/admin/e2e), and how CI will run them.
---

# End-to-end tests (Playwright) -- plan and conventions

## Honest status
- No Playwright dependency, config, or `e2e/` folder exists. `@playwright/test` shows in `pnpm-lock.yaml` only because `next` lists it as an optional peer.
- No `data-testid` attributes exist in either app (`grep -rn data-testid apps/*/src` -> 0).
- There is no CI workflow (`.github/workflows/` absent).
- Current automated coverage: `packages/shared/src/policy.test.ts` (node:test), `workers/media/tests/*` (pytest), and manual smoke scripts in `apps/admin/scripts/*.mts`.
Everything below is the intended setup. Update this file when it lands.

## When this applies
- Adding the first e2e suite, or a browser-level regression test for a ticket whose acceptance criteria are user-visible (sign-in gate, RSVP, gallery visibility, face search UI, admin forms).
- Visual review of themes x locales.

## Where things live

| Path | What |
|---|---|
| `apps/web/e2e/` | guest-site specs (`gate.spec.ts`, `rsvp.spec.ts`, `gallery.spec.ts`, `themes.spec.ts`) |
| `apps/admin/e2e/` | admin specs (`login.spec.ts`, `guests-import.spec.ts`, `gallery-upload.spec.ts`) |
| `apps/*/playwright.config.ts` | `baseURL`, projects (chromium desktop + `Pixel 7` mobile), `webServer` pointing at `pnpm dev:web|admin`, `use.extraHTTPHeaders` not needed (host is in the URL) |
| `e2e/support/` (per app) | `mailpit.ts` (read magic links), `session.ts` (mint cookie via the same code as `apps/admin/scripts/smoke-session.mts`), `fixtures.ts` (seeded users) |
| `packages/db/prisma/seed.ts` | the only fixture source: `admin@localhost` (platform admin + studio OWNER), `priya@localhost` (HOST, also a guest), guests `lakshmi@localhost` (+15125550101), `maya@localhost` (+1 plus-one), `nikhil@localhost`, `riya@localhost`, `arjun@localhost`; events `priya-arjun` (LIVE, en/te/hi), `sofia-james` (LUXURY), `emma-liam` (ROMANTIC) where `admin@localhost` is a guest |

## Conventions in this repo
- **Run against the real local stack** (`pnpm infra:up`, `pnpm db:reset`, `pnpm dev`, worker optional). No mocks of Prisma or S3; Mailpit is the email sink, console is the SMS sink.
- **Sign in through Mailpit, never through DB shortcuts in user-facing specs.** Request the link via the UI, then:
  ```ts
  const r = await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`).then(r => r.json());
  const msg = await fetch(`${MAILPIT}/api/v1/message/${r.messages[0].ID}`).then(r => r.json());
  const link = msg.Text.match(/https?:\/\/\S*(callback\?token=|\/i\/)\S*/)![0];
  await page.goto(link);   // sets hub_session; lands on / or /rsvp
  ```
  Clear the mailbox in `beforeEach` (`DELETE /api/v1/messages`) so the newest message is the right one. A `storageState` per seeded user is acceptable for admin specs after the first UI login.
- **Minted sessions only for setup**, via a helper that calls `createSession()` exactly like `smoke-session.mts`, to seed state quickly (e.g. an INVITE_LINK session to assert elevated actions are refused).
- **Hostnames:** guest specs use `http://priya-arjun.localhost:3000` etc. Chromium resolves `*.localhost` to loopback; no `/etc/hosts`. Admin specs use `http://localhost:3001`.
- **Selectors:** prefer roles and accessible names (`getByRole("button", { name: "Sign in" })`, `getByLabel`). Add `data-testid` only where text is localized or ambiguous: naming `area-thing` (`gallery-album-card`, `rsvp-submit`, `face-consent`). Keep them in JSX only, never in CSS.
- **Locale under test** is set with `?lang=te` once per test (middleware sets the cookie and redirects).
- **Isolation:** every spec that writes (RSVP, favorites, admin forms) must be idempotent or reset via `pnpm db:reset` in `globalSetup`; never depend on spec order.
- **Screenshots:** `themes.spec.ts` iterates `[priya-arjun, sofia-james, emma-liam] x [en, te, hi]` x `[/, /schedule, /rsvp, /gallery]` at 1280 and 390 px, `toHaveScreenshot()` with `maxDiffPixelRatio: 0.01`; fonts are Google-hosted so run with network and `animations: "disabled"`; Luxury is dark -- check contrast in both.
- **No emojis in test names or fixtures**; test titles read like acceptance criteria from the ticket.

## Common tasks

### Install Playwright (when the ticket is picked)
1. Test first: write `apps/web/e2e/gate.spec.ts` asserting that `/rsvp` signed-out shows the contact input and no nav, and that an unknown address gets the same confirmation text as a known one. It fails because nothing runs it yet.
2. `pnpm --filter @hub/web add -D @playwright/test && pnpm --filter @hub/web exec playwright install chromium` (same for admin).
3. `apps/web/playwright.config.ts`: `testDir: "./e2e"`, `webServer: { command: "pnpm dev", port: 3000, reuseExistingServer: true }`, `use: { baseURL: "http://priya-arjun.localhost:3000", trace: "retain-on-failure" }`.
4. Scripts: `"e2e": "playwright test"` in each app; root `"e2e": "pnpm -r e2e"`. Do **not** add e2e to `pnpm verify` until it is stable; add a separate CI job.
5. Add `e2e/support/mailpit.ts` + `fixtures.ts`; add the first `data-testid`s only where the gate spec needs them.
6. Document the real commands here and in `CLAUDE.md`.

### Suggested first specs (map to acceptance criteria)
| Spec | Asserts |
|---|---|
| web `gate` | signed-out = sign-in only; same message for known/unknown; magic link signs in; `/auth/signout` clears |
| web `invite` | `/i/<token>` from a seeded invite lands on `/rsvp` with INVITE_LINK scope; host actions absent |
| web `rsvp` | household members and only invited sub-events shown; meal only where `servesMeal`; saved state reloads; audit row exists (via Prisma in the test) |
| web `gallery` | guest cannot open hosts-only album (404); watermarked until comped unlock; favorite toggles |
| web `face` | consent required (`consent_required`), disabled event shows disabled copy; with worker up, selfie upload returns results (fixture image) |
| admin `login` | magic link via Mailpit; `?reauth=1` after forcing `authedAt` back 13 h |
| admin `settings` | retention 29 rejected, 30 accepted; audit `event.retention.change` |
| admin `upload` | drop a JPEG -> `UPLOADED` -> worker -> `READY` (poll Photo status) |

## CI (planned)
GitHub Actions job: services `pgvector/pgvector:pg16`, `rustfs/rustfs`, `axllent/mailpit` (or `docker compose -f infra/docker-compose.yml up -d` on the runner); `pnpm install --frozen-lockfile`; `pnpm db:migrate && pnpm db:seed`; start web/admin with `pnpm build && pnpm -r start` (or `dev`); `playwright install --with-deps chromium`; `pnpm e2e`; upload `playwright-report/` and traces on failure. Python worker optional for face specs (`make models` needs network; cache `workers/media/models`).

## Gotchas (anticipated)
- `*.localhost` cookies are host-only; a session on one event site does not exist on another -- log in per site.
- The admin app and guest sites share `hub_session` cookie name on different hosts; clear cookies between admin and guest steps.
- Mailpit stores mail in memory; restarting the container during a run empties it.
- Fonts load from Google; offline runs change screenshots. Pin a `--disable-remote-fonts`-free approach by waiting for `document.fonts.ready`.
- `Uploader` falls back to `/api/upload` on CORS failure; a spec must allow either path.
- Face specs need a real face image; keep one small CC0 fixture under `e2e/fixtures/` and never a real guest's photo.
- Luxury theme likely renders on the light default background today (see `tailwind-themes` gotchas); snapshot baselines will shift when fixed.

## Verification (once installed)
```bash
pnpm infra:up && pnpm db:reset
pnpm --filter @hub/web exec playwright test --project=chromium
pnpm --filter @hub/web exec playwright show-report
```

## References
- `docs/01-architecture.md` §4 ("theme gallery renders every page in every theme x every locale for visual review"; sign-in screen rules)
- `docs/04-plan.md` Phase 0 CI; §4 risk on Indic fonts (visual regression in te/hi)
- Playwright: https://playwright.dev/docs/intro; screenshots: https://playwright.dev/docs/test-snapshots; webServer: https://playwright.dev/docs/test-webserver
- Mailpit API: https://mailpit.axllent.org/docs/api-v1/
- Related skills: `docker-local-infra`, `auth-sessions-policy`, `tailwind-themes`, `tdd-workflow`
