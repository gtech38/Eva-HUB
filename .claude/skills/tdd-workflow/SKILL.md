---
name: tdd-workflow
description: How test-driven development is enforced and practised in this repo — the red→green→refactor loop, where tests live for each package, which runner to use (vitest for all TypeScript, pytest, Playwright), how the .claude hooks gate source edits, and how to write acceptance-criteria-driven tests for a backlog ticket. Load before changing any code under apps/, packages/ or workers/.
---

# TDD workflow

## When this applies
Every change to behaviour. Also when a hook blocks you with "TDD gate" or "post-edit check".

## The loop, as enforced here

| Step | What you do | What enforces it |
|---|---|---|
| Red | Create/extend the test file for the module. Encode one acceptance criterion from the ticket. Run it. It must fail for the right reason. | `tdd_gate.py` (PreToolUse) refuses source edits when no test file exists. |
| Green | Smallest change that passes. | `post_edit_check.py` (PostToolUse) runs tsc + the sibling test after every edit and returns failures (and unscoped-Prisma-query findings) to you; size/coupling heuristics are advisory (stderr, non-blocking). |
| Refactor | Improve names/structure with tests green. Apply `solid-design`. | Same post-edit check; `stop_verify.py` re-runs typecheck + tests for the packages this session edited (ledger in `.claude/.touched/<session_id>`; falls back to `git status` only if the ledger is missing) before you finish. `packages/db` tests and pytest are skipped with a note when Postgres :5433 is down. |

One failing test at a time. If you find yourself writing three tests before any code, stop and make the first one pass.

## Where tests live

| Package | Runner | Test location | Run |
|---|---|---|---|
| `packages/shared` | vitest | `src/<name>.test.ts` (e.g. `src/policy.test.ts`) | `pnpm --filter @hub/shared test` or `cd packages/shared && pnpm exec vitest run src/policy.test.ts` |
| `packages/db` | vitest | `src/<name>.test.ts`; DB-backed tests hit local Postgres | `cd packages/db && pnpm exec vitest run src/index.test.ts` |
| `apps/web` | vitest | `src/lib/<name>.test.ts`, `src/**/__tests__/`; harness tests in `test/` | `pnpm --filter @hub/web test` |
| `apps/admin` | vitest | same pattern | `pnpm --filter @hub/admin test` |
| `workers/media` | pytest | `tests/test_<module>.py` | `cd workers/media && .venv/bin/pytest -q tests/test_jobs.py` |
| `scripts/*.sh` (backup, restore drill) | pytest, driving the script end to end | `scripts/tests/test_<script>.py` (not covered by the TDD gate; follow the loop anyway) | `python -m pytest -q scripts/tests` with any venv that has pytest + psycopg |
| e2e | Playwright (planned) | `apps/*/e2e/` | see `e2e-playwright` skill |

One TypeScript runner: **vitest** (do not add `node:test` files; vitest reports them as "No test suite found"). Write `import { describe, it, expect } from "vitest"` explicitly (no globals). Each package has its own `vitest.config.ts` (`vitest.config.mts` in the Next apps, which are not `"type": "module"`) importing the shared collection globs from the root `vitest.shared.mts` (`src/`, `test/` and `tests/` x `*.{test,spec}.{ts,tsx}` -- every location the gate accepts), and lists `vitest` in its own `devDependencies`: the post-edit hook runs `pnpm exec vitest run <file>`, and reports a package without vitest as a problem instead of running anything. The root `vitest.config.mts` lists all four as `test.projects`, so `pnpm exec vitest run` at the root runs everything; `pnpm test` (`pnpm -r test`) runs `vitest run` per package. In the Next apps, `@/` resolves to `src/`, `server-only` is stubbed, and `test/setup.ts` loads the root `.env` so `env()` parses.

The gate looks for: `<stem>.test.ts(x)`, `<stem>.spec.ts(x)`, `__tests__/<stem>.test.ts(x)` beside the source, or `<pkg>/tests/<path-under-src>/<stem>.test.ts(x)` (the test's directory must mirror the source's, so `tests/foo/index.test.ts` does not count for `src/index.ts`); for Python `tests/test_<stem>.py`, `tests/test_<dir>_<stem>.py` or `tests/<dir>/test_<stem>.py`. Name tests to match.

Shell scripts (`scripts/*.sh`) are tested as black boxes: a pytest file runs the script against scratch databases/containers and asserts exit codes and output (`scripts/tests/test_backup_restore_drill.py` is the model). Cover the negative paths too, and from **both** sides: a script that "fails when broken" must be shown failing when the thing it checks is broken (a truncated dump), not only when its expected input is edited. Under `CI`, make such tests fail rather than skip when their stack is missing; a vacuous green run is worse than a red one. Docs that carry copy-pasted SQL/JSON get a test too (`scripts/tests/test_backups_doc.py`, and the runbook SQL is executed in a rolled-back transaction).

## What does NOT need its own unit test
Route-file shells (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`), `themes/**`, `components/**` (presentational; covered by Playwright/visual), `middleware.ts`, any `*.config.{ts,mts,cts,js,mjs,cjs}` (`next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.config.mts`, `playwright.config.ts`), migrations, `__init__.py`. Logic inside those must be lifted into `lib/` where it is testable. If a file is pure wiring, write `// tdd-exempt: <reason>` in it — the gate honours the marker (in the content being written, including `MultiEdit` payloads, or anywhere in the first 4 KB of the existing file, so later edits stay exempt) and leaves an auditable trail (`grep -r tdd-exempt`).

## Reality on main
Most existing modules have **no test yet**. At the time of writing the TS tests are `packages/shared/src/{policy,names}.test.ts`, `packages/db/src/index.test.ts`, `apps/web/src/lib/eventCopy.test.ts`, `apps/admin/src/lib/eventSchemas.test.ts` and the harness tests in `apps/*/test/`; the worker has `tests/test_jobs.py` and `tests/test_face_synthetic.py`. Several modules cannot be unit-tested without infrastructure: anything touching Prisma needs Postgres (`pnpm infra:up`), storage adapters need S3/RustFS, the face pipeline needs the ONNX models (`make models`).

The gate applies to **edits**, not to history, so the first edit to an untested module is where its test gets written -- even for a one-line fix. Expect that cost; it is the point. In practice:

- Pure logic (`lib/`, `policy.ts`, mappers, parsers): add `src/<name>.test.ts` next to it and test the seam directly. This is the common case and takes minutes.
- Modules that need Postgres: follow `packages/db/src/index.test.ts` -- probe the DB at the top (top-level `await`), wrap the suite in `describe.skipIf(!dbUp)` and log why when it is unreachable, use `TEST_*` job types / unique prefixes, clean up in `afterAll()`. The Stop hook already skips these when :5433 is closed.
- Modules that need S3/ONNX or a real browser: the harness is tracked under EPIC-QUALITY -- #83 (test infrastructure epic), #84 (Vitest workspace for shared/db/web/admin; done), #86 (Playwright against the local stack), #88 (first unit tests for auth helpers and gallery rules), #109 (tenant isolation suite). Until those land, lift the logic you are changing into a pure function and test that; leave the adapter call as thin wiring.
- Genuinely untestable wiring (route shells, adapter registration, config glue): mark it `// tdd-exempt: <why>` (`# tdd-exempt:` in Python). The marker is the convention; `grep -r tdd-exempt` is the audit.

## Writing tests from a ticket
Each ticket's **Acceptance criteria** checkbox becomes at least one test. Name the test with the criterion text:

```ts
it("invite-link session can RSVP but cannot manage guests", () => { ... });
```

```python
def test_failed_job_requeues_with_backoff_then_dies(db):
    ...
```

Prefer testing the seam the ticket names (a `lib/` function, a handler, `can()`), not the UI. Server actions: extract the logic into a pure function in `lib/` and test that; the action itself becomes thin wiring.

## Patterns in this codebase

- **Policy tests** (`packages/shared/src/policy.test.ts`): build a `Principal` with a `base()` helper, assert `can()`; add one test per new matrix cell.
- **Postgres-backed tests** (`workers/media/tests/test_jobs.py`): use the real local DB (`DATABASE_URL`), create rows with unique prefixes, clean up in a fixture. Tests must be rerunnable without `db:reset`.
- **Fake adapters**: `email()`/`sms()`/storage are interfaces; in tests pass a recording fake rather than hitting Mailpit. For the worker, `tests/test_face_synthetic.py` shows model-backed tests that need no face images.
- **No sleeps**: poll with a bounded loop or inject the clock.
- **Mailpit as oracle** in integration tests: `GET http://localhost:8025/api/v1/messages` then `/api/v1/message/<ID>` to read the magic link.

## Worktrees

Agents usually work in a linked worktree (`git worktree add <scratch>/wt-<id> -b <id>/<slug> dev`). The hooks resolve every path against the checkout of *this* repository that owns it, so the TDD gate, post-edit checks and Stop verification apply inside worktrees exactly as in the main tree; checkouts of other repositories pass through untouched.

- Run `pnpm install` in the worktree first. Until `node_modules` exists the hooks skip checks and say so ("worktree … is not bootstrapped").
- A worktree has no `.env`; the hooks pass the main tree's `.env` to every check they run. For your own commands, symlink it: `ln -s "<main>/.env" .env && ln -s ../../.env packages/db/.env`.
- Python checks use the worktree's `.venv` if present, otherwise the main tree's `workers/media/.venv`.
- The touched-file ledger (`.claude/.touched/<session>`) stores absolute paths, so the Stop hook verifies the worktree's packages, not the main tree's.
- Hook behaviour is covered by `.claude/hooks/tests/` (`workers/media/.venv/bin/python -m pytest -q .claude/hooks/tests`), which CI runs.

## Commands

```bash
pnpm verify                          # everything the Stop hook runs, plus pytest
pnpm --filter @hub/shared test
pnpm exec vitest run                 # all four TS packages from the root (test.projects)
cd packages/shared && pnpm exec vitest run src/policy.test.ts
cd workers/media && .venv/bin/pytest -q -x tests/test_jobs.py -k backoff
HOOK_FAST=1                          # env: skip tsc in the post-edit hook (tests still run)
TDD_GATE=off                         # env: disable the gate for a session; never commit with it on
```

## Gotchas
- `tsc` for a Next app takes 10–20 s; the hook uses `--incremental` with `.tsbuildinfo-hook` (gitignored).
- The gate keys on file *existence*, not content. An empty test file is cheating yourself; the post-edit hook will run it and it will pass vacuously. Write the assertion.
- Python tests run from `workers/media`; relative imports need `hub_worker.` prefix.
- Seed emails lack a TLD (`priya@localhost`); don't use `z.string().email()` in validation you test against seed data.

## References
- `backlog/README.md` — ticket format; acceptance criteria drive tests
- `.claude/hooks/*.py` — the enforcement code; read it when a block surprises you
- `solid-design` skill — what to do in the refactor step
