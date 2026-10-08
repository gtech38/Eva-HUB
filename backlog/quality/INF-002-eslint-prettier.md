---
id: INF-002
title: ESLint and Prettier configuration for the monorepo
labels: [type:chore, area:infra, priority:p1, size:S, agent-ready]
milestone: Phase 0 — Foundations
epic: EPIC-QUALITY
---

## Context
Both Next apps declare `"lint": "next lint"` but there is no ESLint config anywhere, and `apps/admin/next.config.ts` has `eslint: { ignoreDuringBuilds: true }`. Several files carry `// eslint-disable-next-line` comments for rules that are never evaluated. Python has no `ruff` config either.

## Scope
- Root `eslint.config.mjs` (flat config): `typescript-eslint` recommended, `eslint-plugin-react-hooks`, `@next/eslint-plugin-next` for the two apps, `eslint-config-prettier` last.
- Root `.prettierrc` (printWidth 140 to match existing style, double quotes, trailing commas) and `.prettierignore` (`.next`, `node_modules`, `pnpm-lock.yaml`, `*.md` under `backlog/`).
- Scripts: root `lint` = `eslint . && prettier --check .`; `format` = `prettier --write .`. Replace `next lint` in both apps with `eslint .`.
- `workers/media/pyproject.toml`: `[tool.ruff]` (line-length 140, select E,F,I,B,UP) and `make lint` target running `ruff check hub_worker tests scripts`.
- Fix or explicitly disable whatever the first run reports so `pnpm lint` is green; do not weaken `typescript-eslint` recommended rules globally.

## Out of scope
- Wiring into CI (INF-004). Type-aware lint rules (too slow for now).

## Acceptance criteria
- [ ] `pnpm lint` exits 0 on a clean checkout.
- [ ] Introducing `const unused = 1;` in `apps/web/src/lib/format.ts` makes `pnpm lint` exit non-zero with `@typescript-eslint/no-unused-vars`.
- [ ] `cd workers/media && make lint` exits 0.
- [ ] `apps/admin/next.config.ts` no longer sets `eslint.ignoreDuringBuilds`.

## Files
- `eslint.config.mjs`, `.prettierrc`, `.prettierignore` (new, root)
- `package.json`, `apps/web/package.json`, `apps/admin/package.json`, `apps/admin/next.config.ts`
- `workers/media/pyproject.toml`, `workers/media/Makefile`

## Verification
```bash
pnpm install && pnpm lint
cd workers/media && make lint
```

## Notes for agents
Start by running `pnpm exec eslint apps/web/src` with a minimal config and treat the first failure list as the failing test. Prefer fixing code over adding ignores; where an ignore is needed, keep it file-local with a reason.
