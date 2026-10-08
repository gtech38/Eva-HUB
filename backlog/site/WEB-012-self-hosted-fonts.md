---
id: WEB-012
title: Self-hosted theme fonts (no Google fetch at build)
labels: [type:tech-debt, area:web, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-SITE
---

## Context
`apps/web/src/themes/fonts.ts` imports eight families from `next/font/google`, which downloads at build time; builds fail offline and in locked-down CI. docs/01 §4 requires Noto Telugu and Devanagari fallbacks in every theme, so font files are a product dependency, not a convenience.

## Scope
- Vendor woff2 files under `apps/web/public/fonts/<family>/` for Cormorant Garamond, Playfair Display, Great Vibes, Inter, Lora, Noto Sans Telugu, Noto Sans Devanagari, Noto Serif Devanagari with the weights/styles currently requested; include each licence file (`OFL.txt`).
- Switch `fonts.ts` to `next/font/local` keeping the same exported names and CSS variables so themes need no change; `display: "swap"`, `preload: false` as today.
- Subsetting: run `pyftsubset` (or `glyphhanger`) for Latin families to `latin` unicode range; keep Indic fonts whole. Document the command in `apps/web/public/fonts/README.md`.
- Size budget: total font payload ≤ 1.2 MB; record actual.

## Out of scope
- Admin app fonts (system stack already). Changing typography.

## Acceptance criteria
- [ ] `pnpm --filter @hub/web build` succeeds with networking disabled (`unshare -n` on Linux or macOS Network Link Conditioner / `--offline` check: no request to `fonts.googleapis.com` in build output).
- [ ] A vitest test asserts `fonts.ts` contains no `next/font/google` import.
- [ ] Visual regression (WEB-013) snapshots show no change beyond anti-aliasing tolerance, or are updated with a note.
- [ ] Each font directory contains a licence file.

## Files
- `apps/web/src/themes/fonts.ts`, `apps/web/public/fonts/**` (new), `apps/web/public/fonts/README.md`

## Verification
```bash
pnpm --filter @hub/web build 2>&1 | grep -c googleapis   # 0
pnpm --filter @hub/web test
```

## Notes for agents
Write the "no google import" test first. Fonts are OFL-licensed; do not add non-OFL fonts.
