---
id: WEB-031
title: 'e2e: link-preview metadata and /og.png on event sites'
labels: [type:chore, area:web, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-003]
epic: EPIC-SITE
---

## Context
WEB-014 (#126) shipped the sign-in-only Open Graph metadata and the public `/og.png`. Its second acceptance criterion (an unauthenticated album page carries `og:image` and no derivative `<img>`) was verified with curl and a pinned metadata unit test, but not by an automated browser-level test, because the Playwright harness (INF-003, #86) did not exist yet. The privacy promise in docs/01 §4 ("previews never show content or photos") needs a regression guard that runs against the real stack. Proposed in the WEB-014 PR as follow-up (c).

## Scope
- `e2e/specs/web/og.spec.ts` (new), using the harness from INF-003 and no session cookie:
  - `GET /gallery/<albumId>` for a seeded event returns the sign-in HTML: exactly one `<meta property="og:image">` whose URL ends in `/og.png`, `og:title` equal to the event's default-locale title, `robots` noindex, and no `<img>` whose `src` contains a derivative path (`/d/` or the storage endpoint).
  - `GET /og.png` returns 200, `image/png`, `Cache-Control: public, max-age=86400`, an `ETag`, and a PNG of 1200×630 (read the IHDR bytes); a second request with `If-None-Match` returns 304.
  - A request with `Host: priya-arjun.localhost` plus a forged `X-Forwarded-Host: sofia-james.localhost` and `x-hub-host: sofia-james.localhost` returns bytes identical to the plain request (sha1 equal).
  - `GET /OG.png`, a literal `/sites/sofia-james/og.png` and an unknown host (`nosuch.localhost/og.png`) return 404.
- Use Playwright's `request` fixture with `extraHTTPHeaders` and `baseURL` per slug; no browser page is needed.

## Out of scope
- Pixel snapshots of the image (WEB-032). Changing the route, metadata or middleware. Admin app.

## Acceptance criteria
- [ ] `pnpm e2e --project=web --grep og` passes locally against the seeded stack.
- [ ] The spec fails if `siteMetadata` stops emitting `og:image`, and if a derivative `<img>` is added to the unauthenticated album page (prove each by temporarily breaking it once and noting the failing output in the PR).
- [ ] The forged-header test fails if `/og.png` is changed to resolve from `X-Forwarded-Host`.

## Files
- `e2e/specs/web/og.spec.ts` (new)
- Read: `apps/web/src/lib/siteMetadata.ts`, `apps/web/src/lib/ogResponse.ts`, `apps/web/src/middleware.ts`, `e2e/playwright.config.ts`

## Verification
```bash
pnpm infra:up && pnpm db:reset
pnpm e2e --project=web --grep og
```

## Notes for agents
Seed slugs are in `packages/db/prisma/seed.ts` (`priya-arjun`, `sofia-james`, `emma-liam`, `baby-reddy`, `reddy-gruhapravesam`, `ravi-50`). Resolve an album id through `@hub/db` in `beforeAll` instead of hard-coding it. Prefer role/label selectors and plain `request` calls to keep the spec fast and independent of fonts. This file must not collide with WEB-001's specs; do not edit them.
