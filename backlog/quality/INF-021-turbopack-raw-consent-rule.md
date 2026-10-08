---
id: INF-021
title: Turbopack rule for ?raw consent-text imports
labels: [type:chore, area:infra, priority:p3, size:S, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [LEG-001]
epic: EPIC-QUALITY
---

## Context
LEG-001 bundles the consent texts (`legal/consent/v<N>/*.md`) as strings via `?raw` imports in `packages/shared/src/consent.ts`. Both apps' `next.config.ts` add a **webpack** rule (`{ resourceQuery: /^\?raw$/, include: <repo>/legal, type: "asset/source" }`); vitest supports `?raw` natively. Turbopack ignores the webpack hook, so `next dev --turbopack` (or a future default switch) fails to resolve the consent module.

## Scope
- Add an equivalent `turbopack.rules` entry to `apps/web/next.config.ts` and `apps/admin/next.config.ts` (e.g. a tiny raw loader for `legal/**/*.md` when imported with `?raw`), scoped to `legal/` only.
- Document it next to the webpack rule and in the `nextjs-app-router` skill.

## Out of scope
- Switching the dev scripts to Turbopack.

## Acceptance criteria
- [ ] `next dev --turbopack` on both apps serves `/gallery/me` (web) and `/platform/legal` (admin) with the consent text rendered.
- [ ] `next build` (webpack) still bundles the texts; no consent text appears in client chunks (`grep -r "never saved" .next/static` is empty).

## Files
- `apps/web/next.config.ts`, `apps/admin/next.config.ts`, `.claude/skills/nextjs-app-router/SKILL.md`

## Verification
```bash
cd apps/web && pnpm exec next dev --turbopack -p 31xx   # then curl /gallery/me with a minted session
pnpm --filter @hub/web build && ! grep -rl "never saved" apps/web/.next/static
```

## Notes for agents
Config-only change (`*.config.ts` is TDD-exempt); prove it with the dev-server smoke above and record the output in the PR.
