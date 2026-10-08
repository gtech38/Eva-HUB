---
id: INF-015
title: Dockerfiles for web and admin (Next standalone) and the worker
labels: [type:chore, area:infra, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-DEPLOY
---

## Context
docs/01 §2: "Docker images. Next.js output: standalone." Neither `apps/web/next.config.ts` nor `apps/admin/next.config.ts` sets `output`, and the monorepo (`transpilePackages: ["@hub/db", "@hub/shared"]`, pnpm workspaces, Prisma client generation) needs a deliberate multi-stage build. The worker needs OpenCV, pyvips/Pillow deps and the ONNX models at a known path.

## Scope
- `apps/web/Dockerfile`, `apps/admin/Dockerfile`: multi-stage (`pnpm fetch` with lockfile → build with `output: "standalone"` and `outputFileTracingRoot` set to the repo root → runtime `node:20-alpine` copying `.next/standalone`, `.next/static`, `public`, generated Prisma client); `GIT_SHA` build arg → env; non-root user; `HEALTHCHECK` hitting `/api/health?live=1`; `prisma migrate deploy` is **not** run in the image (runbook step, DOC-006).
- `workers/media/Dockerfile`: `python:3.13-slim`, system libs for `opencv-contrib-python-headless` (libgl not needed for headless; `libglib2.0`), `pip install .`, models downloaded at build via `scripts/download_models.py` (sha256-pinned) into `/models` with `FACE_MODEL_DIR=/models`; `CMD python -m hub_worker all`; optional `--build-arg EXTRA=gpu` (WRK-013); `HEALTHCHECK` on `/health`.
- `.dockerignore` files; `infra/docker-compose.build.yml` to build all three locally; `pnpm docker:build`.
- CI (INF-004): build the three images on `main` (no push yet) to catch breakage.
- `next.config.ts`: `output: "standalone"` gated by `process.env.DOCKER_BUILD` so `pnpm dev` is unaffected; `outputFileTracingIncludes` for Prisma engines.

## Out of scope
- Registry push and deploy (INF-018/DOC-006). Caddy.

## Acceptance criteria
- [ ] `docker build -f apps/web/Dockerfile .` and the admin/worker builds succeed from a clean clone with no network except package registries.
- [ ] `docker run` of each image with the compose network and `.env` passes its health check; web serves `http://priya-arjun.localhost:3000` via the container (port mapped).
- [ ] Image sizes recorded: web/admin < 350 MB, worker < 1.5 GB.
- [ ] CI builds all three on `main`.

## Files
- `apps/web/Dockerfile`, `apps/admin/Dockerfile`, `workers/media/Dockerfile`, `.dockerignore`, `apps/*/.dockerignore`, `workers/media/.dockerignore`, `infra/docker-compose.build.yml` (new)
- `apps/web/next.config.ts`, `apps/admin/next.config.ts`, `.github/workflows/ci.yml`, `package.json`

## Verification
```bash
pnpm docker:build
docker compose -f infra/docker-compose.yml -f infra/docker-compose.build.yml up -d && curl -s localhost:3000/api/health
```

## Notes for agents
The failing test is the build itself; start with the worker (simplest). Prisma's query engine must be included in the standalone output; verify with a container `curl` that hits the DB.
