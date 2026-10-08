---
id: WEB-033
title: Page live selfie-search results instead of returning up to 500 DTOs
labels: [type:tech-debt, area:web, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [WEB-017]
epic: EPIC-GALLERY
---

## Context
WEB-017 paged the album, favorites and "earlier matches" feeds. A live selfie search (`POST /api/face/search`) still runs `LIMIT 500` in SQL and returns every visible match as a `PhotoDTO` in one response, so a popular guest gets up to 500 DTOs (1,000 presigned URLs) in a single JSON body, and `FaceSearch` renders them all (the grid virtualises above 300, but the response and the presigning are unbounded by page).

## Scope
- `POST /api/face/search` keeps the SQL match and the `PhotoMatch` upserts exactly as today but returns only the first page (60) of DTOs plus `nextCursor`, reusing `listMatchPage` / `encodeScoreCursor` after the upsert (the matches are now durable rows, so `GET /api/gallery/me?subject=` can serve the rest).
- `FaceSearch` hands the result to `PhotoGrid` with `more={{ endpoint: "/api/gallery/me?subject=<subject>", nextCursor }}`.
- Keep the consent, opt-out and `resolveFaceSubject` rules untouched.

## Out of scope
- Raising or removing the 500-match SQL limit; changing the match threshold.

## Acceptance criteria
- [ ] The search response for a subject with 200 matches contains at most 60 photos and a cursor that the `/api/gallery/me` feed accepts, with no gaps or duplicates across pages (route test with the worker and Prisma faked, plus a Postgres paging test).
- [ ] Opted-out subjects still get 403 `opted_out` from both the search route and the feed.

## Files
- `apps/web/src/app/api/face/search/route.ts`, `apps/web/src/app/api/face/search/route.test.ts`
- `apps/web/src/components/gallery/FaceSearch.tsx`, `apps/web/src/lib/gallery.ts`

## Verification
```bash
pnpm --filter @hub/web test
```

## Notes for agents
Read `apps/web/src/lib/gallery.ts` (`listMatchPage`), `apps/web/src/lib/faceSubject.ts` and the "Who may be searched" bullet in the `face-recognition-pipeline` skill first.
