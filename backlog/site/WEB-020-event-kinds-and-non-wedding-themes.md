---
id: WEB-020
title: Event kinds and three non-wedding themes (baby shower, Telugu ceremony, gala)
labels: [type:feature, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-SITE
---

## Context
The product is for events, not only weddings, but every theme hard-coded wedding copy ("are getting married", "Married!") and the only seeded events were weddings. docs/05-theme-references.md now specifies three additional high-end templates and a kind-aware copy layer.

## Scope
- `Event.kind` (`EventKind` enum: WEDDING, ENGAGEMENT, BABY_SHOWER, BIRTHDAY, ANNIVERSARY, CEREMONY, PARTY, CORPORATE, OTHER), default WEDDING, migration.
- `ThemeKey` gains NURSERY_SAGE, TELUGU_TRADITIONAL, MIDNIGHT_GALA; theme packs under `apps/web/src/themes/`.
- `apps/web/src/lib/eventCopy.ts`: `eventCopy(kind, locale)` and `hostsPageLabel(kind, locale)`; all six themes read `copy` instead of literal wedding strings; nav label for WEDDING_PARTY follows the kind.
- Admin: kind select on create and settings; theme picker lists all six with swatches and "suits" hints.
- Seed: Sofia & James and Emma & Liam fully populated (pages, 3–4 sub-events, households, albums); new events `baby-reddy`, `reddy-gruhapravesam`, `ravi-50`.

## Out of scope
- Per-kind page types (e.g. a registry that is a charity for parties) — content stays on the fixed page set.
- Hero image upload / accent overrides (WEB-010).

## Acceptance criteria
- [ ] `eventCopy("BABY_SHOWER","en")` and every non-wedding kind contain no "marr*" string in any field
- [ ] Every kind returns non-empty copy for en, te, hi (English fallback)
- [ ] `hostsPageLabel` returns "Wedding Party" for WEDDING, "Hosts" for PARTY/BABY_SHOWER, "Family" for CEREMONY
- [ ] All six sites render their hero with kind-correct copy (manual: screenshots of the six seeded slugs)
- [ ] Admin create/settings persist `kind`; Zod rejects unknown kinds/themes

## Files
`packages/db/prisma/schema.prisma`, `apps/web/src/lib/eventCopy.ts`, `apps/web/src/themes/{types,index,fonts}.ts`, `apps/web/src/themes/*/index.tsx`, `apps/web/src/app/sites/[slug]/{layout,page}.tsx`, `apps/admin/src/lib/data.ts`, `apps/admin/src/app/studios/[studioId]/actions.ts`, `apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`, `packages/db/prisma/seed.ts`, `docs/05-theme-references.md`

## Verification
```bash
cd apps/web && pnpm exec vitest run src/lib/eventCopy.test.ts
pnpm typecheck && pnpm db:seed
# open http://{baby-reddy,reddy-gruhapravesam,ravi-50,sofia-james,emma-liam,priya-arjun}.localhost:3000 and sign in as admin@localhost
```

## Notes for agents
First failing test: `apps/web/src/lib/eventCopy.test.ts` ("never say married"). Themes are exempt from the TDD gate (presentational); the copy module is not. Keep Telugu first-class in TELUGU_TRADITIONAL (Noto Serif Telugu is in the display stack, not a fallback).
