---
id: INF-012
title: OpenTelemetry traces for the Next apps and the FastAPI worker
labels: [type:feature, area:infra, area:web, area:admin, area:worker, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-015]
epic: EPIC-OBS
---

## Context
docs/01 §10: "OpenTelemetry traces. Any backend works: Grafana, Honeycomb or Axiom." A face search spans web → worker → Postgres; a slow gallery render spans Prisma + S3 presigning. Logs (SHR-015) give correlation; traces give timing.

## Scope
- Next apps: `instrumentation.ts` registering `@vercel/otel` (or `@opentelemetry/sdk-node`) with OTLP HTTP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; Prisma instrumentation (`@prisma/instrumentation`), `fetch` auto-instrumentation (propagates `traceparent` to the worker), S3 client instrumentation via `@opentelemetry/instrumentation-aws-sdk`; resource attributes `service.name=hub-web|hub-admin`, `service.version=GIT_SHA`; span attributes `studioId/eventId` from the request context (never PII).
- Worker: `opentelemetry-sdk` + FastAPI and psycopg instrumentation; job spans `job.<type>` with `jobId/eventId` from `run_once`; `traceparent` extracted from `payload._meta` when present so an upload's `PROCESS_PHOTO` links to the request that created it.
- Local: optional compose profile `otel` with `grafana/otel-lgtm` (Tempo+Grafana) at `:3002`; `docs/observability.md` with screenshots-free instructions.
- Sampling: `OTEL_TRACES_SAMPLER=parentbased_traceidratio` default 0.1 in production, 1.0 locally.
- Tests: in-memory span exporter asserts a web request creates a span with `eventId`; pytest asserts `run_once` wraps the handler in a span with `job.type`.

## Out of scope
- Metrics/dashboards. Log shipping.

## Acceptance criteria
- [ ] With the `otel` profile running, a face search shows one trace with spans in `hub-web`, `hub-worker` and Postgres queries.
- [ ] Without the endpoint env, no exporter is created and startup time is unchanged (unit).
- [ ] Span attributes contain no email, phone or embedding values (assert in tests).

## Files
- `apps/web/src/instrumentation.ts`, `apps/admin/src/instrumentation.ts`, `apps/*/next.config.ts`, `packages/shared/src/otel.ts` (new)
- `workers/media/hub_worker/{otel.py,api.py,jobs.py,__main__.py}`, `workers/media/pyproject.toml`
- `infra/docker-compose.yml` (profile), `docs/observability.md` (new)

## Verification
```bash
docker compose -f infra/docker-compose.yml --profile otel up -d
pnpm test && cd workers/media && make test
```

## Notes for agents
First failing test: span carries `job.type`. Keep OTel optional; the local default path must not import the SDK eagerly.
