---
id: WEB-012
title: Self-hosted theme fonts (no Google fetch at build)
labels: [type:tech-debt, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-SITE
---

## Context
`apps/web/src/themes/fonts.ts` imported fifteen families (six themes) from `next/font/google`, which downloads at build time; builds fail offline and in locked-down CI. docs/01 §4 requires Noto Telugu and Devanagari fallbacks in every theme, so font files are a product dependency, not a convenience.

## Scope
- Vendor woff2 files under `apps/web/src/themes/font-files/<family>/` for all fifteen families in `fonts.ts` (Instrument Serif, Luxurious Script, Inria Serif, Cinzel, Pinyon Script, Cormorant Garamond, Marcellus, Bodoni Moda, Manrope, JetBrains Mono, Inter, Noto Sans Telugu, Noto Serif Telugu, Noto Sans Devanagari, Noto Serif Devanagari) with the weights/styles currently requested; include each licence file (`OFL.txt`). The files sit beside `fonts.ts` rather than in `public/` because `next/font/local` emits hashed copies into `_next/static/media`, so a `public/` copy would be served twice.
- Switch `fonts.ts` to `next/font/local` keeping the same exported names and CSS variables so themes need no change; `display: "swap"`, `preload: false` as today.
- Subsetting: Latin families to `latin` + `latin-ext` (Inter: `latin` only, to stay in budget; Marcellus ships whole because its licence reserves the font name); Telugu and Devanagari families to their own script range; all layout features and licence name IDs 13/14 kept. The reproducible recipe is `apps/web/src/themes/font-files/build.sh` (pinned `fonttools==4.66.1`, `brotli==1.2.0`, `--no-harfbuzz-repacker`), documented in `apps/web/src/themes/font-files/README.md`.
- Size budget: total font payload ≤ 1.2 MB; record actual (1,139,488 bytes).

## Out of scope
- Admin app fonts (system stack already). Changing typography.

## Acceptance criteria
- [ ] `pnpm --filter @hub/web build` succeeds with networking disabled (`unshare -n` on Linux or macOS Network Link Conditioner / `--offline` check: no request to `fonts.googleapis.com` in build output).
- [ ] A vitest test asserts that no file under `apps/` imports `next/font/google` or `@next/font/google`, and that `fonts.ts` uses `next/font/local`.
- [ ] A vitest test asserts the font files total at most 1.2 MB.
- [ ] A vitest test asserts every theme's `--font-*` variables map to a declared local family, and that each family keeps the weights/styles requested before this ticket.
- [ ] Visual regression (WEB-013) snapshots show no change beyond anti-aliasing tolerance, or are updated with a note. (Checked by hand against `origin/dev` until WEB-013 lands: at most 0.012% of pixels differ.)
- [ ] Each font directory contains the full OFL text; only allow-listed families may declare a Reserved Font Name; every file keeps licence name IDs 13 and 14.

## Files
- `apps/web/src/themes/fonts.ts`, `apps/web/src/themes/fonts.test.ts`, `apps/web/src/themes/fontFiles.test.ts`, `apps/web/src/themes/font-files/**` (new, including `README.md` and `build.sh`), `.claude/skills/tailwind-themes/SKILL.md`

## Verification
```bash
pnpm --filter @hub/web build 2>&1 | grep -c googleapis   # 0
pnpm --filter @hub/web test
```

## Notes for agents
Write the "no google import" test first. Fonts are OFL-licensed; do not add non-OFL fonts. To add or change a family, edit `font-files/build.sh`, run it, and follow "Adding or changing a family" in `font-files/README.md`.
