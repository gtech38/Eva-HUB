---
id: INF-003
title: Playwright e2e harness against the local stack
labels: [type:chore, area:infra, area:web, area:admin, priority:p0, size:M, agent-ready]
milestone: Phase 0 — Foundations
epic: EPIC-QUALITY
---

## Context
The private-site gate, magic links (Mailpit), RSVP and the gallery can only be verified end to end. `apps/admin/scripts/smoke-*.mts` are ad-hoc scripts, not tests. This ticket builds the harness; the actual flows are WEB-001 and ADM-001.

## Scope
- New workspace package `e2e/` (`@hub/e2e`) with `@playwright/test`, `playwright.config.ts`: two projects, `web` (baseURL `http://priya-arjun.localhost:3000`) and `admin` (`http://localhost:3001`); `webServer` entries that run `pnpm dev:web` / `pnpm dev:admin` unless `E2E_EXTERNAL_SERVERS=1`.
- Helper `e2e/lib/mailpit.ts`: `latestMessageTo(address)` and `extractLink(html, pattern)` using the Mailpit REST API at `http://localhost:8025/api/v1/`; `deleteAll()` for test isolation.
- Helper `e2e/lib/auth.ts`: `signInGuest(page, slug, email)` (sign-in form → Mailpit → callback) and `signInAdmin(page, email)`; both return once the session cookie is set.
- Helper `e2e/lib/db.ts`: thin Prisma access (`@hub/db`) to read seed ids (event `priya-arjun`, a seeded guest email) and to reset `LoginToken`/`Session` rows between runs.
- A single smoke spec `e2e/specs/smoke.spec.ts`: unauthenticated `GET /` on the event site renders the sign-in form and no nav; `GET /robots.txt` disallows everything.
- Root scripts: `e2e` = `pnpm --filter @hub/e2e test`, `e2e:ui` for headed mode.

## Out of scope
- The RSVP/gallery/admin flows (WEB-001, ADM-001). Visual regression (WEB-013). CI wiring (INF-004).

## Acceptance criteria
- [ ] With `pnpm infra:up && pnpm db:migrate && pnpm db:seed` done, `pnpm e2e` passes the smoke spec on Chromium.
- [ ] `signInGuest` completes a magic-link login for a seeded guest in under 10 s and the page shows the household name.
- [ ] Running the suite twice in a row passes (helpers clean Mailpit and tokens).
- [ ] `pnpm typecheck` includes `e2e/`.

## Files
- `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/lib/{mailpit,auth,db}.ts`, `e2e/specs/smoke.spec.ts` (new)
- `pnpm-workspace.yaml`, `package.json`
- Read first: `apps/web/src/app/sites/[slug]/auth/actions.ts`, `apps/web/src/app/sites/[slug]/auth/callback/route.ts`, `apps/admin/src/app/login/actions.ts`, `packages/db/prisma/seed.ts`

## Verification
```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm e2e            # smoke spec green
pnpm e2e && pnpm e2e  # idempotent
```

## Notes for agents
Write `smoke.spec.ts` first and run it against a stopped server to see the failure, then add `webServer`. `*.localhost` resolves in Chromium without hosts entries. Mailpit's API: `GET /api/v1/search?query=to:<addr>` then `GET /api/v1/message/<ID>`. Never read tokens from the DB to sign in; the point is to exercise the real email path.
