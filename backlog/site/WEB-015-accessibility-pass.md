---
id: WEB-015
title: Accessibility pass (WCAG 2.1 AA) across themes
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-003]
epic: EPIC-SITE
---

## Context
Guests span ages and devices; the gallery lightbox, RSVP form and sign-in gate must work with keyboard and screen readers. Known gaps: the lightbox `dialog` in `PhotoGrid.tsx` has no focus trap or `aria-label`, thumbnails use `alt=""` with filename-only button labels, colour tokens were not checked for contrast (Luxury `--muted` on `--bg`), the language switcher has no accessible name, and heading order varies by theme.

## Scope
- `@axe-core/playwright` in the e2e `web` project: run axe on every page in every theme (reuse the WEB-013 matrix at one viewport); fail on `serious`/`critical`.
- Fix findings: focus trap and `Escape` in the lightbox (`inert` on background, restore focus), `aria-label` for the dialog with photo index, visible focus rings in each theme's tokens, skip link, landmark roles in the three `Shell`s, `lang` attribute (already) plus `dir`, labelled form controls in `SignIn`, RSVP radios grouped with `fieldset/legend`, `aria-live` for sign-in and RSVP result messages, accessible names for icon buttons (heart, close, prev/next already partly labelled), contrast adjustments to tokens where needed (document changed values).
- Reduced motion: respect `prefers-reduced-motion` for `fade-in` and hover scale.
- `docs/accessibility.md` with the checklist and how to run axe.

## Out of scope
- Admin app (separate pass later). Screen-reader manual testing beyond VoiceOver spot checks noted in the PR.

## Acceptance criteria
- [ ] axe reports 0 serious/critical violations on all pages × themes (e2e spec).
- [ ] Keyboard-only e2e: open lightbox with Enter, navigate with arrows, close with Escape, focus returns to the thumbnail.
- [ ] Contrast of `--fg`/`--muted` on `--bg`/`--surface` ≥ 4.5:1 for all three themes (unit test over theme `vars` using the ADM-013 `contrastRatio` helper or a local copy).

## Files
- `e2e/specs/web/a11y.spec.ts` (new), `apps/web/src/components/gallery/PhotoGrid.tsx`, `apps/web/src/components/{SignIn,chrome,PageHeader}.tsx`, `apps/web/src/themes/*/index.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/sites/[slug]/rsvp/page.tsx`, `docs/accessibility.md`

## Verification
```bash
pnpm e2e --grep a11y
pnpm --filter @hub/web test
```

## Notes for agents
Run the axe spec first and treat its report as the failing test. Token changes affect WEB-013 baselines; update them in the same PR with a note.
