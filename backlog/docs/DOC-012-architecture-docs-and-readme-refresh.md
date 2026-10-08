---
id: DOC-012
title: Architecture docs, diagrams and README refresh to match the code
labels: [type:chore, area:docs, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [DOC-010]
epic: EPIC-DOCS
---

## Context
`docs/01-architecture.md` §1 says "two deployable services, web and worker" and §11 proposes `apps/web` holding dashboards and `packages/themes|i18n|adapters`; the code has `apps/admin`, themes inside `apps/web/src/themes`, adapters inside `packages/shared`. §9 says Better Auth; the code is self-built. The README's "Planning documents" table still points to `docs/schema.draft.prisma` as the schema. CLAUDE.md is accurate and should remain the short source.

## Scope
- Update `docs/01-architecture.md`: Mermaid system diagram with `web`, `admin`, `worker` (consumer + FastAPI), Postgres, bucket, Caddy; §7 messaging path per ADR-0008; §9 auth per ADR-0006; §11 replaced by the real layout (match CLAUDE.md); mark Phase 3 items clearly.
- `docs/03-data-model.md`: point to `packages/db/prisma/schema.prisma` as source of truth; move `docs/schema.draft.prisma` to `docs/archive/` with a note; list the schema deltas introduced by this backlog (DB-001 etc.) as "planned".
- `docs/04-plan.md`: add a "Status as of <date>" section mapping Phase 0/1 items to done/in-backlog with ticket ids.
- README: fix the docs table, add Backlog and ADR links, add the admin app to the architecture summary, keep the decisions table.
- Sequence diagram for upload → PROCESS_PHOTO → INDEX_FACES → CLUSTER_FACES → PROFILE_AUTO notice updated with the actual dedupe keys and delays (20 s).

## Out of scope
- New design decisions.

## Acceptance criteria
- [ ] No remaining mention of "two deployable services" or `packages/themes` in `docs/`; a grep check added to `pnpm lint` for `schema.draft.prisma` references outside `docs/archive`.
- [ ] Mermaid blocks render (validate with `@mermaid-js/mermaid-cli` in a script or CI step).
- [ ] README commands all work on a clean clone.

## Known drift to fix (collected 2026-10-07 from a code audit)
- docs/01 §3: middleware does not look up `Domain` or cache 60 s; it rewrites to `/sites/{slug}` and `lib/site.ts` resolves `Domain` per request.
- docs/01 §4: no `unstable_cache`/`revalidateTag`; all site pages are `force-dynamic`. i18n is `packages/shared/src/i18n.ts`, not next-intl.
- docs/01 §5: single presigned PUT + admin `/api/upload` proxy, not multipart; derivatives via Pillow, not pyvips.
- docs/01 §9: auth is self-built (`packages/shared/src/auth.ts`), not Better Auth.
- docs/01 §2 / README / .env.example: object storage is RustFS locally (MinIO images withdrawn); creds unchanged.
- docs/01 §11 and "two deployable services": three services (web, admin, worker); themes live in `apps/web/src/themes`, adapters/i18n in `packages/shared`; no Turborepo.
- docs/02 §4 matrix vs `can()`: planners/vendors cannot create face profiles in code; VENDOR has full `rsvp.report`; host "purge request" not implemented. Decide which side is right and align both.
- docs/03 §2.8: no `visible_photos` SQL view; visibility is `apps/web/src/lib/gallery.ts`. §2.10 CHECK constraint missing (DB-001). §2.13 `scoped()` is a where-helper, not a Prisma extension (TEN-* tickets).
- CLAUDE.md: `i/[token]/route.ts` also links guest→user (via a verified delivered contact) — document it as the second sanctioned path; `completeUpload` enqueues after its transaction, not inside.
- docs/01 §7: `FIRE_REMINDER` only stamps `firedAt` (WRK-002). docs/02 §2: no OTP sign-in path yet (AUTH tickets).
- docs/05-theme-references.md is new and should be linked from README and docs/01 §4.

## Files
- `docs/01-architecture.md`, `docs/03-data-model.md`, `docs/04-plan.md`, `docs/archive/schema.draft.prisma` (moved), `README.md`, `scripts/docs-check.mjs` (new)

## Verification
```bash
node scripts/docs-check.mjs
pnpm exec mmdc -i docs/01-architecture.md -o /tmp/arch.md   # or the chosen validation
```

## Notes for agents
Treat the grep check as the failing test. Do not rewrite the decision history; add status, do not delete rationale.
