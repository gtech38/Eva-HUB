---
name: pnpm-monorepo
description: Use when adding or wiring packages, changing root/package scripts, fixing module-resolution or typecheck errors across apps/web, apps/admin, packages/db, packages/shared, or when pnpm/corepack/exFAT quirks bite. Covers workspace:* deps, TS-source packages with .ts import extensions, Next transpilePackages, root scripts (verify, typecheck, test, infra:*, db:*, backlog:sync).
---

# pnpm monorepo

## When this applies
- Adding a package under `packages/*` or `apps/*`, or a dependency between them.
- `pnpm typecheck` / `pnpm test` / `pnpm verify` failing for resolution reasons.
- Editing root `package.json` scripts or `pnpm-workspace.yaml`.
- Anything odd on the exFAT volume (`._*` files, permissions, symlinks).

## Where things live

| Path | What |
|---|---|
| `package.json` (root) | `packageManager: pnpm@9.15.9`; all cross-cutting scripts |
| `pnpm-workspace.yaml` | `packages: [apps/*, packages/*]` (the Python worker is NOT a workspace member) |
| `apps/web` `@hub/web` | Next 15 guest sites, port 3000 |
| `apps/admin` `@hub/admin` | Next 15 admin, port 3001 |
| `packages/db` `@hub/db` | Prisma schema/client, `scoped()`, `enqueue()` |
| `packages/shared` `@hub/shared` | env, i18n, pages, policy, storage, email, sms, auth |
| `workers/media` | Python; own `Makefile`, `.venv`, `pyproject.toml` |
| `scripts/backlog-sync.mjs` | `pnpm backlog:sync` (gh CLI) |
| `scripts/env-docs.mjs`, `scripts/env-meta.mjs` | `pnpm env:docs` / `--check`: env reference generator and per-variable metadata |
| `.env` | Single root env file; `apps/web/.env` and `packages/db/.env` are symlinks to it |

## Conventions in this repo
- **Packages ship TypeScript source, not builds.** `packages/shared/package.json` `exports` map every subpath to `./src/*.ts`; `packages/db` `main`/`types` point at `./src/index.ts`. No `dist/`, no build step.
- **Relative imports inside packages carry the `.ts` extension** (`import { env } from "./env.ts"` in `packages/shared/src/auth.ts`). Every tsconfig sets `allowImportingTsExtensions: true`, `moduleResolution: "Bundler"` (`bundler` in apps), `noEmit: true`.
- **Next consumes the source via `transpilePackages: ["@hub/db", "@hub/shared"]`** and keeps native deps out of the bundle with `serverExternalPackages: ["@prisma/client", "nodemailer", "@aws-sdk/client-s3", ...]` (`apps/web/next.config.ts`, `apps/admin/next.config.ts`).
- **Workspace deps are `workspace:*`** (`"@hub/db": "workspace:*"` in both apps and in `@hub/shared`).
- **Env is loaded once at the root.** Next configs call `dotenv.config({ path: ../../.env })`; the worker's `config.py` resolves `../../../.env` by path. Do not add per-package `.env` files; add a symlink if a tool insists (that is why `packages/db/.env -> ../../.env` exists for `prisma`).
- Shared versions: `typescript ^5.6.3`, `zod ^3.23.8`, `@prisma/client ^6.1.0`, `next ^15.1.0` (lockfile resolves 15.5.x), `react ^19`.
- Tests: **vitest** is the only TypeScript runner. Every package has `"test": "vitest run"`, `vitest` in its own `devDependencies` (the post-edit hook refuses to run a package's tests without it), and a `vitest.config.ts` (`.mts` in the Next apps, which are not `"type": "module"`) that imports the shared `include`/`exclude` globs from the root `vitest.shared.mts`. The root `vitest.config.mts` lists every package in `test.projects`. `pnpm test` = `pnpm -r test`, so a package without a `test` script is silently skipped.

## Root scripts

| Script | Runs |
|---|---|
| `pnpm dev` | `pnpm -r --parallel --filter ./apps/* dev` (web :3000 + admin :3001) |
| `pnpm dev:web` / `pnpm dev:admin` | one app |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | `pnpm -r test` (`vitest run` in shared, db, web, admin) |
| `pnpm lint` | `node scripts/env-docs.mjs --check && pnpm -r lint` (the env docs drift check runs first, then `next lint` in each app) |
| `pnpm env:docs` | `node scripts/env-docs.mjs`: regenerates `.env.example` and the table in `docs/deploy/env.md` from `env.ts`, the worker's `DEFAULTS` and `scripts/env-meta.mjs`; run it after touching any of them |
| `pnpm verify` | `typecheck && test && cd workers/media && make test` -- run before any PR |
| `pnpm db:generate|migrate|seed|reset` | delegates to `@hub/db` (`prisma generate`, `prisma migrate dev`, `tsx prisma/seed.ts`, `prisma migrate reset --force`) |
| `pnpm infra:up|down|nuke` | `docker compose -f infra/docker-compose.yml up -d|down|down -v` |
| `pnpm backlog:sync [--dry-run] [ID]` | syncs `backlog/**/*.md` to GitHub issues |

## Common tasks

### Add a new workspace package (e.g. `packages/adapters`)
1. Test first: create `packages/adapters/src/index.test.ts` with `import { describe, it, expect } from "vitest"` that imports from `./index.ts` and asserts the first exported function. It will fail to resolve until step 2.
2. `mkdir -p packages/adapters/src`; copy `packages/shared/package.json`, `tsconfig.json` and `vitest.config.ts` as templates. Set `"name": "@hub/adapters"`, `"type": "module"`, `exports` to `./src/*.ts`, scripts `"typecheck": "tsc --noEmit"` and `"test": "vitest run"`, `vitest` in `devDependencies` (`pnpm --filter @hub/adapters add -D vitest`), and `test.name: "@hub/adapters"` in its `vitest.config.ts`.
3. Add `"packages/adapters"` to `test.projects` in the root `vitest.config.mts`.
4. Add consumers: in `apps/web/package.json` add `"@hub/adapters": "workspace:*"`, and add `"@hub/adapters"` to `transpilePackages` in both `next.config.ts` files.
5. `pnpm install` (updates `pnpm-lock.yaml`), then `pnpm --filter @hub/adapters test && pnpm typecheck`.

### Add a dependency to one package
```bash
pnpm --filter @hub/shared add some-lib          # runtime
pnpm --filter @hub/web add -D some-types        # dev
```
If it is a native/Node-only module used in server code, also add it to `serverExternalPackages` in both Next configs. Test: `pnpm --filter @hub/web typecheck` and `pnpm --filter @hub/web build`.

### Add a test to an app (apps/web or apps/admin)
Both apps already run vitest (`apps/*/vitest.config.mts`: node environment, `@/` -> `src/`, `server-only` stubbed, `test/setup.ts` loads the root `.env`).
1. Write `apps/web/src/lib/gallery.test.ts` (pure functions only: `visibleVisibilities`, etc.) with `describe/it/expect` from `vitest`. Files that import `next/headers` or `next/navigation` need a request context; keep tested logic in `lib/` modules without Next imports.
2. `cd apps/web && pnpm exec vitest run src/lib/gallery.test.ts`, then `pnpm --filter @hub/web test` and `pnpm test`.

### Add a root script
Edit root `package.json`; follow the delegate pattern (`pnpm --filter @hub/db <script>`). Test by running it and by `pnpm verify` still passing.

## Gotchas
- **exFAT `._*` AppleDouble files** appear next to every file (`._package.json`, `._src`). They are git-ignored (`._*` in `.gitignore`) and skipped by `scripts/backlog-sync.mjs`, but any new glob/walker you write must skip names starting with `._`. `find ... -not -name '._*'`.
- exFAT has no POSIX permissions; everything shows `-rwx------`. Do not "fix" modes. Symlinks (`.env`) do work.
- `tsconfig.tsbuildinfo` files in `apps/*` are build artifacts (`*.tsbuildinfo` is ignored); never hand-edit.
- Importing `@hub/shared` (root) from a `"use client"` file pulls `@aws-sdk`, `nodemailer`, `node:crypto` into the browser bundle and fails. Client code may only import `@hub/shared/i18n` and `@hub/shared/pages` (see `nextjs-app-router`).
- `pnpm -r test` with no `test` script in a package is not an error -- a green `pnpm test` does not mean the apps were tested.
- Corepack: `corepack enable` once so the `packageManager` field pins pnpm 9.15.9; a different global pnpm major rewrites the lockfile format.
- The Python worker is outside pnpm. `pnpm verify` reaches it only through `cd workers/media && make test`; `make test` uses `.venv/bin/python` (3.13) and skips DB tests if Postgres is down.
- `prisma` CLI reads `packages/db/.env` (symlink) -- if you ever see "Environment variable not found: DATABASE_URL", the symlink was lost (exFAT copy/paste drops them). Recreate: `ln -s ../../.env packages/db/.env`.

## Verification
```bash
pnpm install --frozen-lockfile      # lockfile in sync
pnpm typecheck
pnpm test
pnpm --filter @hub/web build && pnpm --filter @hub/admin build
pnpm verify                         # the PR gate
git status --short | grep -v '^??'  # no stray ._ files staged
```

## References
- `CLAUDE.md` Layout and Commands sections
- `docs/01-architecture.md` §11 (proposed layout -- note it still shows `packages/themes`, `packages/i18n`, `packages/adapters` and Turborepo, none of which exist; themes live in `apps/web/src/themes`, i18n in `packages/shared/src/i18n.ts`)
- pnpm workspaces: https://pnpm.io/workspaces
- Next `transpilePackages`: https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages
- Related skills: `tdd-workflow`, `nextjs-app-router`, `docker-local-infra`
