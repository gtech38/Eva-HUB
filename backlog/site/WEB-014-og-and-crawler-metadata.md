---
id: WEB-014
title: Open Graph and crawler metadata limited to the sign-in screen
labels: [type:feature, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-SITE
---

## Context
docs/01 §4: "Open Graph previews show only the sign-in screen's title and monogram. They never show content or photos." `generateMetadata` in `sites/[slug]/layout.tsx` sets only `title`; there is no `og:image`, so WhatsApp/iMessage fall back to scraping the first image or show nothing. `X-Robots-Tag: noindex, nofollow` and `robots.txt` already exist.

## Scope
- `generateMetadata`: `title`, `description` = "You're invited — sign in to view", `robots: { index: false, follow: false }`, `openGraph: { title, type: "website", images: [/og.png] }`, `twitter: { card: "summary" }`; no page-specific metadata on inner pages (they inherit).
- `/og.png` route (`apps/web/src/app/sites/[slug]/og.png/route.tsx`) using `next/og` `ImageResponse`: theme background/accent colours, monogram and title only; 1200×630; cached `public, max-age=86400` (this one asset is safe to cache: it has no content). Fonts via `fetch` of the local woff2 (WEB-012).
- Middleware matcher updated so `og.png` is routed per site.
- A static `favicon` per theme optional; default `favicon.ico` present.

## Out of scope
- Public pages (none exist by design).

## Acceptance criteria
- [ ] `curl -I http://priya-arjun.localhost:3000/og.png` returns 200 `image/png` without a session cookie.
- [ ] `GET /gallery/<albumId>` unauthenticated returns HTML whose `<meta property="og:image">` points to `/og.png` and contains no `<img>` with a derivative URL (e2e).
- [ ] Snapshot test of the OG image against the three themes (visual project).

## Files
- `apps/web/src/app/sites/[slug]/layout.tsx`, `apps/web/src/app/sites/[slug]/og.png/route.tsx` (new), `apps/web/src/middleware.ts`

## Verification
```bash
pnpm e2e --grep "og"
curl -sI http://priya-arjun.localhost:3000/og.png | head -3
```

## Notes for agents
First failing test: unauthenticated album page has no derivative `<img>` (it already passes; keep it as the regression guard) plus the `og:image` assertion. `ImageResponse` runs on the Node runtime here; do not mark the route `edge`.
