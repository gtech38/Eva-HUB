---
id: EPIC-SITE
title: Guest site completeness: pages, theming, fonts, i18n, accessibility
labels: [type:epic, area:web, priority:p1, size:L]
milestone: Phase 1 — MVP
---

## Context
`apps/web` ships three themes and the Home, About, Schedule, Travel, FAQ, Gallery and RSVP pages. Against docs/01 §4: the Registry and Wedding Party pages are missing (the admin can already edit registry items and cash funds); hosts can only change the monogram, not accent colours or the hero image; fonts come from Google at build time (`apps/web/src/themes/fonts.ts` uses `next/font/google`, so offline builds fail); Telugu/Hindi catalogs are partial; there is no visual regression or accessibility check; OG metadata is only the title.

## Children
- WEB-009 Registry and Wedding Party pages
- ADM-030 Wedding Party member photo upload in the page editor
- ADM-013 Hero image upload and accent-colour overrides
- WEB-012 Self-hosted fonts
- WEB-013 Visual regression and performance budget for 3 themes × 3 locales
- SHR-006 Complete te/hi UI catalogs with a missing-key check
- WEB-014 Open Graph and crawler metadata limited to the sign-in screen
- WEB-015 Accessibility pass (WCAG 2.1 AA)
- WEB-020 Event kinds and three non-wedding themes (baby shower, Telugu ceremony, gala)
- WEB-030 Resolve the event site from the trusted x-hub-host in getSite()
- WEB-031 e2e: link-preview metadata and /og.png on event sites
- WEB-032 Image snapshots of /og.png for every seeded theme

## Definition of Done
- [ ] All nine `PageType`s render in all three themes and three locales with screenshots under version control.
- [ ] `pnpm --filter @hub/web build` succeeds with network disabled.
- [ ] axe reports zero serious/critical violations on every page in every theme.
- [ ] Shared links preview only the sign-in title and monogram.
