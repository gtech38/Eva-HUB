---
id: ADM-013
title: Hero image upload and accent-colour overrides (admin form + theme merge)
labels: [type:feature, area:admin, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-SITE
---

## Context
docs/01 §4: "The host can change accent colors, the hero image and the monogram. Layout is not editable." `Event.themeOverrides` holds only `monogram` (`settings/page.tsx`), `HomeContent.heroKey` is defined in `packages/shared/src/pages.ts` but nothing uploads to it, and `storage.keys.hero()` exists unused. Themes expose `vars` with `--accent`, `--accent-2`, `--accent-fg`.

## Scope
- Zod schema `ThemeOverrides` in `packages/shared/src/pages.ts`: `{ monogram?: string; accent?: hex; accent2?: hex; accentFg?: hex; heroKey?: string | null }`; `parseThemeOverrides()`.
- Admin settings: colour inputs with the theme's defaults shown as placeholders and a "Reset" per field; contrast warning (WCAG AA 4.5:1 against `--bg`/`--surface`) computed server-side with a small `contrastRatio()` helper; hero image upload (JPEG/PNG ≤ 15 MB) via `presignUpload` to `keys.hero()` with the `/api/upload`-style proxy fallback, then a `PROCESS_HERO` step done inline in the action (resize to 2400 px with `sharp`, since the worker should not be required for site content) → store key in `HomeContent.heroKey` and `themeOverrides.heroKey`; remove hero.
- Web: `sites/[slug]/layout.tsx` merges `parseThemeOverrides(event.themeOverrides)` into `theme.vars` before applying the style; `Hero` receives `heroUrl` from `derivativeUrl(heroKey)` (already in `HeroProps`).
- Audit `event.theme.update`.

## Out of scope
- Font or layout overrides. CDN URL for hero (SHR-008 covers derivatives; hero follows the same path later).

## Acceptance criteria
- [ ] `parseThemeOverrides` rejects non-hex colours and strings longer than 12 for monogram (unit tests).
- [ ] `contrastRatio("#c9a961", "#0b0a09")` ≥ 4.5 and the warning appears for `#888888` on `#808080` (unit test).
- [ ] Setting `accent` changes the rendered `--accent` style attribute on the theme root (vitest render of the layout helper or e2e DOM check).
- [ ] e2e: upload a 100×100 PNG hero in settings, event home shows an `<img>` whose URL responds 200.

## Files
- `packages/shared/src/pages.ts`, `packages/shared/src/pages.test.ts`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/settings/page.tsx`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `apps/admin/src/lib/contrast.ts` (new)
- `apps/web/src/app/sites/[slug]/layout.tsx`, `apps/web/src/app/sites/[slug]/page.tsx`, `apps/web/src/themes/*/index.tsx`

## Verification
```bash
pnpm --filter @hub/shared test && pnpm --filter @hub/admin test
pnpm e2e --grep "hero|accent"
```

## Notes for agents
First failing test: `parseThemeOverrides`. `sharp` is a native dep; add it to `apps/admin` only and to `serverExternalPackages`.
