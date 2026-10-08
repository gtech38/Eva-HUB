---
id: WEB-001
title: e2e: guest sign-in, RSVP and gallery flows
labels: [type:feature, area:web, priority:p0, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-003]
epic: EPIC-QUALITY
---

## Context
The MVP "done when" in docs/04-plan.md is a guest receiving an invitation, RSVPing and seeing the gallery. These are the regressions that matter most and currently nothing guards them.

## Scope
Specs under `e2e/specs/web/`:
- `signin.spec.ts`: unknown address shows the same "If you're on the guest list…" message as a known one (response text identical, no token row created for the unknown one); seeded guest completes magic link and lands on `/`.
- `invite-link.spec.ts`: create an `InviteToken` through `@hub/db` for a seeded guest, visit `/i/<token>`, assert redirect to `/rsvp`, session cookie present, and that `/gallery/me` works but any admin URL is refused (INVITE_LINK scope).
- `rsvp.spec.ts`: household member sets ATTENDING + meal for a meal-serving sub-event, submits, reloads and sees saved state; plus-one name is persisted.
- `gallery.spec.ts`: album list renders seeded photos (seed needs at least one READY photo with derivatives: add a tiny fixture JPEG upload in the spec's `beforeAll` via `storage.putObject` + direct `Photo` row); lightbox opens with ArrowRight/Escape; favorite toggles and persists; `/api/photos/<id>/download` returns 403 when no entitlement and 302 after creating a `GALLERY_FULLRES` entitlement row.

## Out of scope
- Face search e2e (needs worker + models; covered by pytest and a later ticket). Visual regression (WEB-013).

## Acceptance criteria
- [ ] All four specs pass on Chromium locally with `pnpm e2e --project=web`.
- [ ] The sign-in spec asserts byte-identical response text for known vs unknown address.
- [ ] The download gating spec covers both 403 and 302 branches.

## Files
- `e2e/specs/web/*.spec.ts` (new), `e2e/lib/{auth,db,mailpit}.ts`
- Read: `apps/web/src/app/sites/[slug]/rsvp/{page.tsx,actions.ts,data.ts}`, `apps/web/src/components/gallery/PhotoGrid.tsx`, `apps/web/src/app/api/photos/[id]/download/route.ts`

## Verification
```bash
pnpm e2e --project=web
```

## Notes for agents
Write `signin.spec.ts` first and watch it fail on the missing helper, then build up. Use `data-testid` sparingly; prefer role/label selectors so the a11y pass (WEB-015) benefits. Clean up fixture photos in `afterAll`.
