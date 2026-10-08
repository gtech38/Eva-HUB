---
id: WEB-032
title: Image snapshots of /og.png for every seeded theme
labels: [type:chore, area:web, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [WEB-013]
epic: EPIC-SITE
---

## Context
WEB-014 (#126) asked for a snapshot test of the OG image against the themes. The PR delivered a colour-mapping snapshot of `ogCardForEvent` (not an image snapshot) plus real renders asserted at 1200×630, and deferred the pixel comparison to the visual-regression project in WEB-013 (#102). That project's scope covers page screenshots only, so `/og.png` is not covered by it. This ticket adds the image snapshots once the `visual` project and its Linux baseline process exist. Proposed in the WEB-014 PR as follow-up (b).

## Scope
- In the `visual` Playwright project from WEB-013, add `e2e/specs/visual/og.spec.ts`: fetch `/og.png` from one seeded event per theme and assert it with `expect(buffer).toMatchSnapshot("og-<slug>.png", { maxDiffPixelRatio: 0.01 })`. Seeded events and themes: `sofia-james` LUXURY, `emma-liam` ROMANTIC, `baby-reddy` NURSERY_SAGE, `reddy-gruhapravesam` TELUGU_TRADITIONAL (Telugu monogram and mixed-script title), `ravi-50` MIDNIGHT_GALA, `priya-arjun` HINDU_TRADITIONAL.
- Add one extra case for Devanagari: set `defaultLocale: "hi"` on a fixture event (restore it in `afterAll`) so the snapshot guards the satori-outliner result for Devanagari clusters (resvg-js shapes them wrongly, see `lib/ogRender.tsx`).
- Baselines under `e2e/__screenshots__/` are generated only inside the Playwright Docker image used by WEB-013; reuse its `pnpm e2e:visual:update` command and document nothing new.

## Out of scope
- Changing the card design, fonts or renderer. Page screenshots (WEB-013). Non-visual assertions on headers or metadata (WEB-031).

## Acceptance criteria
- [ ] Seven baseline PNGs (six themes plus the Devanagari case) are committed and `pnpm e2e --project=visual --grep og` passes twice in a row.
- [ ] Changing the LUXURY accent colour in `apps/web/src/lib/ogCard.tsx` makes the `sofia-james` snapshot fail with a diff artifact.
- [ ] Each snapshot is 1200×630 (assert the IHDR before comparing so a size drift gives a clear message).

## Files
- `e2e/specs/visual/og.spec.ts` (new), `e2e/__screenshots__/**` (new baselines)
- Read: `apps/web/src/lib/ogCard.tsx`, `apps/web/src/lib/ogRender.tsx`, `apps/web/assets/og-fonts/README.md`, `packages/db/prisma/seed.ts`

## Verification
```bash
pnpm e2e --project=visual --grep og
# regenerate baselines with the command documented in WEB-013 (Playwright Docker image)
```

## Notes for agents
Blocked until WEB-013 lands the `visual` project and the baseline-generation command; do not invent a second snapshot mechanism. The renderer is deterministic (committed static fonts, no system fonts, no network), so `maxDiffPixelRatio` can stay tight; if a baseline differs between machines, that is a bug in determinism to report, not a reason to loosen the threshold.
