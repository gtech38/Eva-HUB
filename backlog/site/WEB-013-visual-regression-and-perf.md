---
id: WEB-013
title: Visual regression and performance budget for 3 themes × 3 locales
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-003]
epic: EPIC-SITE
---

## Context
docs/01 §4: "A Storybook-style theme gallery renders every page in every theme × every locale for visual review." docs/04 risk: "Rendering Indic scripts in luxury display fonts — include Telugu and Hindi in the visual regression tests." Seed has three events, one per theme.

## Scope
- Playwright project `visual` in `e2e/`: for each seeded theme event × locale (`?lang=`) × page (`/`, `/about`, `/schedule`, `/travel`, `/faq`, `/registry`, `/party`, `/rsvp`, `/gallery`, sign-in gate), take full-page screenshots at 390×844 and 1280×800 with `toHaveScreenshot` (maxDiffPixelRatio 0.01), fonts loaded (`document.fonts.ready`), animations disabled, countdown frozen via `page.clock`.
- Baselines committed under `e2e/__screenshots__/` generated on Linux Chromium (CI image) only; `pnpm e2e:visual:update` documented.
- Performance budget: Lighthouse CI (`@lhci/cli`) on gallery and home for the Luxury theme at mobile preset; assertions: performance ≥ 85, total JS ≤ 250 kB gzip, LCP ≤ 2.5 s on simulated 4G; `lighthouserc.json`; runs in the CI `e2e` job.
- A doc page `docs/visual-review.md` explaining how to review diffs.

## Out of scope
- Admin app visuals. Pixel-perfect design review.

## Acceptance criteria
- [ ] 90 screenshots (10 pages × 3 themes × 3 locales) at two viewports exist as baselines and the suite passes twice in a row on CI.
- [ ] Changing `--accent` in the Luxury theme fails the suite with a diff image artifact.
- [ ] Lighthouse assertions pass; a report artifact is uploaded in CI.

## Files
- `e2e/playwright.config.ts`, `e2e/specs/visual/*.spec.ts`, `e2e/__screenshots__/**`, `lighthouserc.json`, `docs/visual-review.md` (new)
- `.github/workflows/ci.yml`

## Verification
```bash
pnpm e2e --project=visual
pnpm exec lhci autorun
```

## Notes for agents
Generate baselines inside the CI Docker image (`mcr.microsoft.com/playwright`) to avoid platform font differences; document the exact command. Freeze `Date` for the countdown.
