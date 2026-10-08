---
name: prisma-postgres
description: Use when touching packages/db (schema.prisma, migrations, seed.ts, src/index.ts), writing $queryRaw/$executeRaw, pgvector queries, the Job table / enqueue(), tenant scoping with scoped(), or running prisma migrate/generate/seed/studio. Covers schema conventions (studioId/eventId, LocalizedText Json, enums, Unsupported("vector(128)")), quoted camelCase columns and enum casts in raw SQL, vector literal binding, and raw-SQL migrations (CHECK, RLS).
---

# Prisma + Postgres (packages/db)

## When this applies
- Changing `packages/db/prisma/schema.prisma` or adding a migration.
- Writing raw SQL from TS (`prisma.$queryRaw`) or Python (`psycopg`).
- Enqueueing jobs or reading the `Job` table.
- Seeding or resetting local data.

## Where things live

| Path | What |
|---|---|
| `packages/db/prisma/schema.prisma` | Source of truth (`docs/schema.draft.prisma` is the planning copy) |
| `packages/db/prisma/migrations/20261007200507_init/migration.sql` | Only migration so far; creates `citext` + `vector` extensions |
| `packages/db/prisma/seed.ts` | Idempotent seed: studio `studio`, admin `admin@localhost`, events `priya-arjun` (LIVE, HINDU_TRADITIONAL, 3 locales), `sofia-james` (LUXURY), `emma-liam` (ROMANTIC), price sheet |
| `packages/db/src/index.ts` | `prisma` singleton (cached on `globalThis` in dev), `scoped()`, `JobType`, `enqueue()` |
| `packages/db/.env -> ../../.env` | Symlink so the `prisma` CLI finds `DATABASE_URL` |
| `workers/media/hub_worker/db.py`, `jobs.py` | Python side of the same tables (psycopg, raw SQL) |

Connection: `postgresql://hub:hub@localhost:5433/hub` (compose maps 5433 -> 5432; image `pgvector/pgvector:pg16`).

## Conventions in this repo
- Generator `prisma-client-js` with `previewFeatures = ["postgresqlExtensions"]`; datasource `extensions = [vector, citext]`.
- **Ids are `String @id @default(cuid())`.** Python inserts generate `'c' + 24 hex` (`db.new_id()`). `Job.id` and `AuditLog.id` are `BigInt autoincrement` -- serialize with `String(j.id)` in React keys.
- **Tenancy columns:** every event-owned table has `eventId`; the ones that also need studio-level listing carry `studioId` (`Household`, `Guest`, `Album`, `Photo`, `Message`, `Order`). `Face.eventId` is denormalized for the filtered exact scan.
- **LocalizedText is `Json`** shaped `{ en?, te?, hi? }` (`Event.title`, `SubEvent.name`, `Album.title`, `EventPage.content` fields). Render with `t()` from `@hub/shared/i18n`; parse page content with `parsePage()`.
- **Enums everywhere** (`UserStatus`, `AuthMethod`, `EventStatus`, `ThemeKey`, `PageType`, `RsvpStatus`, `AlbumVisibility`, `PhotoStatus`, `JobStatus`, `EntitlementScope`, ...). In raw SQL cast literals: `'READY'::"PhotoStatus"`.
- **Vectors:** `embedding Unsupported("vector(128)")` on `Face` and `FaceProfile`. Prisma cannot read/write them; use raw SQL. TS inlines a validated literal: `Prisma.raw(\`'[${nums.join(",")}]'::vector\`)` (see `apps/web/src/app/api/face/search/route.ts`). Python passes `vec_literal(v)` as a `%s::vector` parameter. Do **not** try `$1::vector` with `Prisma.sql` parameter binding for the array -- Prisma sends it as text/JSON and pgvector rejects it.
- **Column names are camelCase and must be double-quoted in SQL:** `f."photoId"`, `"runAt"`, `"lockedBy"`. Table names too: `"Face"`, `"Job"`.
- **Soft delete** via `deletedAt` on `User` and `Guest`; always add `deletedAt: null` to guest queries.
- `citext` on `ContactPoint.value` and `Guest.email` (case-insensitive unique).
- `Photo @@unique([eventId, checksum])` dedupes re-uploads; `Guest @@unique([eventId, userId])` is one guest row per user per event.
- `PRISMA_LOG=1` env enables query logging.

## Job table and `enqueue()`

| | TS `enqueue(type, payload, { runAt?, dedupeKey?, tx? })` (`packages/db/src/index.ts`) | Python `jobs.enqueue(conn, type, payload, dedupe_key=, run_at=, delay_s=)` |
|---|---|---|
| no dedupeKey | plain insert | plain insert |
| key absent | insert | insert |
| key QUEUED | payload refreshed; `runAt = GREATEST(existing, new)`; `attempts` kept; lock/error cleared | same (`ON CONFLICT ... DO UPDATE`) |
| key SUCCEEDED/FAILED/DEAD | reset to QUEUED; `runAt = new`; `attempts = 0`; lock/error cleared | same |
| key RUNNING | return existing, no change | returns `None` |

Both sides implement the **same** semantics (the TS side mirrors the worker's upsert; `packages/db/src/index.test.ts` and `workers/media/tests/test_jobs.py::test_dedupe_key_semantics` pin it). Neither side changes `type` on an update. The one difference: TS is read-then-update, the worker is a single `INSERT ... ON CONFLICT`; pass `tx` from TS when atomicity matters.

Dedupe keys in use: `process:{photoId}`, `faces:{photoId}`, `cluster:{eventId}`, `reminder:{ruleId}`, `purge-face:{eventId}:{ts}`. The claim query is `FOR UPDATE SKIP LOCKED ... WHERE status='QUEUED' AND "runAt" <= now()`; a retrying failure sits in QUEUED with `lastError` set, never in FAILED (see `python-media-worker`). Pass `tx` to enqueue inside the same transaction as the row that triggers the job.

## `scoped()` tenant helper
`scoped({ studioId, eventId })` returns `whereEvent(where)`, `whereEventOnly(where)`, `whereStudio(where)` fragments that pre-bind ids. It is a where-fragment helper, not a Prisma `$extends` middleware (docs/03 §2.13 describes the extension as the plan). App code today mostly filters explicitly (`where: { id, eventId, studioId }`); either is acceptable, an unscoped event query is not.

## Common tasks

### Add a column or table
1. Test first: in the consumer that will use it, write a vitest test asserting the new field appears (e.g. a pure mapper in `apps/*/src/lib`), or in `workers/media/tests/` if Python reads it.
2. Edit `schema.prisma`; add `studioId`/`eventId` if tenant-owned; add `@@index` for the access path.
3. `pnpm db:migrate` (prompts for a name -> `packages/db/prisma/migrations/<ts>_<name>/migration.sql`), which also runs `prisma generate`.
4. If the worker reads it, update the raw SQL in `hub_worker/handlers/*.py` and the README table there.
5. `pnpm typecheck` (generated client types) and `pnpm db:seed` still idempotent.

### Write a raw-SQL migration (CHECK constraint, RLS, view)
```bash
cd packages/db && pnpm exec prisma migrate dev --create-only --name photomatch_subject_check
```
Edit the generated `migration.sql`, e.g.:
```sql
ALTER TABLE "PhotoMatch" ADD CONSTRAINT "PhotoMatch_one_subject"
  CHECK (num_nonnulls("userId", "subjectGuestId") = 1);
-- RLS (Phase 3): ALTER TABLE "Guest" ENABLE ROW LEVEL SECURITY; CREATE POLICY ... USING ("eventId" = current_setting('hub.event_id', true));
```
Then `pnpm exec prisma migrate dev` to apply. Test: a Python test in `workers/media/tests/` that inserts a violating row inside a rolled-back transaction and expects `psycopg.errors.CheckViolation`. Note: the schema comment on `PhotoMatch` says this CHECK exists "via raw migration" but the init migration does not contain it.

### Query with pgvector from TS
```ts
const vec = Prisma.raw(`'[${emb.map((x) => x.toPrecision(9)).join(",")}]'::vector`);
const rows = await prisma.$queryRaw<Array<{ photoId: string; score: number }>>(Prisma.sql`
  SELECT f."photoId", MAX(1 - (f.embedding <=> ${vec})) AS score
  FROM "Face" f WHERE f."eventId" = ${eventId}
  GROUP BY f."photoId" HAVING MAX(1 - (f.embedding <=> ${vec})) >= ${threshold}`);
```
Validate every number is finite before inlining (the route does). `<=>` is cosine distance; embeddings are L2-normalized so `1 - distance` is cosine similarity.

### Reset local data
```bash
pnpm db:reset        # prisma migrate reset --force: drops, re-migrates, runs the seed (package.json "prisma.seed")
pnpm db:seed         # re-run seed alone (upserts; safe)
```

### Inspect
```bash
cd packages/db && pnpm exec prisma studio                     # GUI on :5555
pnpm exec prisma db execute --stdin <<< 'SELECT count(*) FROM "Job";'
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT status, count(*) FROM "Job" GROUP BY 1;'
```

## Gotchas
- `prisma migrate dev` is interactive and refuses on drift; if the DB was touched by hand, `pnpm db:reset` (destroys local data).
- Both the TS and Python sides write `Job`; keep `JobType` in `packages/db/src/index.ts` and `JOB_TYPES`/`default_handlers()` in `workers/media/hub_worker/jobs.py` in sync, plus the `Job.type` comment in the schema.
- `DateTime` columns are `timestamp(3)` without tz; the worker forces `timezone=UTC` on its session so `now()` matches Prisma. Compare with naive UTC in Python (`db.utcnow()`).
- `BigInt` fields (`Job.id`, `Photo.originalBytes`) are JS `bigint`; `JSON.stringify` throws -- convert with `String()`/`Number()`.
- `Json` fields typed as `Prisma.InputJsonValue` reject `undefined`; strip undefined keys first (`savePage` in admin does this).
- `Face`, `Favorite`, `PhotoMatch` cascade on photo delete; `Entitlement.photoId`/`OrderItem.photoId` have no FK.
- `LoginTokenPurpose.OTP` and `AuthMethod.EMAIL_OTP/SMS_OTP/PASSKEY` exist in the schema but only `MAGIC_LINK`/`EMAIL_LINK`/`INVITE_LINK` are issued today (SMS magic links are recorded as `SMS_OTP`).
- The seed uses `@prisma/client` directly with `dotenv/config`, not `@hub/db`, so it can run before the client singleton exists.

## Verification
```bash
pnpm db:generate && pnpm typecheck
cd packages/db && pnpm exec prisma migrate status
pnpm db:seed                         # prints "Seeded." twice-run safe
cd workers/media && make test        # test_jobs.py exercises claim/backoff/dedupe against the real DB
```

## References
- `docs/03-data-model.md` (modelling decisions; items 8 `visible_photos` view and 13 `$extends` wrapper are not implemented -- visibility lives in `apps/web/src/lib/gallery.ts`, scoping in `scoped()`)
- `workers/media/README.md` "Job semantics"
- Prisma raw queries: https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries
- pgvector: https://github.com/pgvector/pgvector#querying
- Related skills: `python-media-worker`, `face-recognition-pipeline`, `docker-local-infra`
