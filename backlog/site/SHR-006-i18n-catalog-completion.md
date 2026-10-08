---
id: SHR-006
title: Complete te/hi UI catalogs and add a missing-key check
labels: [type:feature, area:shared, area:web, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
epic: EPIC-SITE
---

## Context
UI strings live in `packages/shared/src/i18n.ts` (`UI` object), `apps/web/src/lib/gallery-strings.ts`, and page-local objects such as `S` in `gallery/me/page.tsx`. Several strings are English-only or hardcoded ("Wedding Party", "This site is not live yet", RSVP form labels, lightbox labels). docs/04 Phase 2: "Telugu and Hindi UI catalogs and content editing."

## Scope
- Consolidate all guest-site UI strings into `packages/shared/src/i18n/{en,te,hi}.ts` typed as `Record<UIKey, string>` so a missing key is a type error; `ui()` reads from them; delete the page-local string objects after moving them.
- Script `scripts/i18n-check.mjs`: fails when any key is missing in te/hi or when a `.tsx` under `apps/web/src` contains an untranslated literal in JSX text (heuristic: `>[A-Z][a-z].*<` outside `components/ui` allowlist). Wire into `pnpm lint`.
- Translate all keys to Telugu and Hindi; mark machine-assisted ones with a `// review` comment list in `docs/i18n.md` for a native speaker.
- Admin content editors: ensure every `LocalizedText` field has te/hi inputs (`localized()` helper already supports it; audit `PageEditor.tsx`).
- Date/number formatting via `Intl` with the active locale (`fmtDayLabel` in `apps/web/src/lib/format.ts`).

## Out of scope
- Translating host-authored content. Admin UI translation (English only).

## Acceptance criteria
- [ ] `node scripts/i18n-check.mjs` passes; deleting one te key makes it fail.
- [ ] No English literal remains in guest-site JSX outside the allowlist (the script enforces).
- [ ] Visual regression baselines for te/hi updated and reviewed.

## Files
- `packages/shared/src/i18n.ts` → `packages/shared/src/i18n/{index,en,te,hi}.ts`, `apps/web/src/lib/gallery-strings.ts`, `apps/web/src/app/sites/[slug]/**/*.tsx`, `apps/web/src/lib/format.ts`
- `scripts/i18n-check.mjs`, `docs/i18n.md` (new)

## Verification
```bash
node scripts/i18n-check.mjs && pnpm typecheck
pnpm e2e --project=visual
```

## Notes for agents
Start by running the check script before moving anything; its output is the work list. Keep keys flat and stable; do not rename existing keys used by themes.
