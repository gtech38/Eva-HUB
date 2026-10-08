---
id: ADM-027
title: Studio-defined defaults: transactional email branding, theme and watermark
labels: [type:feature, area:admin, area:shared, area:worker, priority:p3, size:S, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [SHR-013, ADM-013]
epic: EPIC-SAAS
---

## Context
docs/04 Phase 3: "Per-studio branding of transactional emails, and studio-defined watermark and theme defaults." `Studio.brandJson` holds `credit/url/logoText`; the worker reads `brandJson.watermark|credit|name` for the watermark text; templates (SHR-013) are platform-branded.

## Scope
- `brandJson` schema (zod in shared): `credit, url, logoText, logoKey (S3 key under s/{studioId}/brand/), emailFromName, replyTo, accent, watermark: { text, opacity, scale, position }, defaultTheme, defaultThemeOverrides`.
- Studio settings: logo upload (reuse ADM-013 upload path), email preview with the studio name/logo, watermark preview (client-side canvas approximation; worker is the source of truth), default theme + overrides applied to new events (`createEvent`).
- Templates: `renderMessage` takes `studioBrand` and uses `emailFromName <noreply@ROOT_DOMAIN>` with `Reply-To: replyTo`; footer "Sent by <Studio> via Event Hub".
- Worker `process_photo._credit` → reads `brandJson.watermark` object; `make_variants` honours opacity/scale/position; re-processing existing photos is a manual "Regenerate watermarks" action enqueuing `PROCESS_PHOTO` for READY photos (dedupe by photo) — note it also re-triggers `INDEX_FACES`; skip when faces already indexed and unchanged (`facesIndexedAt` kept; `process_photo` should not reset it — verify).

## Out of scope
- White-label removal of the platform footer (explicitly not offered, README decision).

## Acceptance criteria
- [ ] `parseBrand` rejects bad opacity/position; defaults fill missing fields (unit).
- [ ] Rendered invitation email uses the studio's from-name and reply-to (unit).
- [ ] Worker applies opacity 0.2 vs 0.8 producing measurably different images (pytest pixel-diff) and keeps `facesIndexedAt` on re-process.
- [ ] New event inherits `defaultTheme` (vitest).

## Files
- `packages/shared/src/brand.ts` + test (new), `packages/shared/src/messaging.ts`, `apps/admin/src/app/studios/[studioId]/{settings/page.tsx,actions.ts}`
- `workers/media/hub_worker/{imaging.py,handlers/process_photo.py}`, `workers/media/tests/test_face_synthetic.py` (watermark cases)

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
cd workers/media && make test -- -k watermark
```

## Notes for agents
First failing test: `parseBrand`. Keep the "Photography by {Studio}" footer credit mandatory in every theme.
