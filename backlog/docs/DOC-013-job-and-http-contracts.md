---
id: DOC-013
title: Contract docs and tests for job payloads and the worker HTTP API
labels: [type:chore, area:docs, area:worker, area:shared, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-DOCS
---

## Context
Job payloads are implied by code on both sides (`enqueue()` callers in TS, `job["payload"]["photoId"]` in Python) and by the table in `workers/media/README.md`; `/embed-selfie` is described in `api.py`'s docstring. The TS `JobType` union and Python `JOB_TYPES` must stay in sync and new jobs (WRK-005, WRK-007, WRK-012, ADM-023) are about to be added.

## Scope
- `docs/contracts/jobs.md`: one section per job type: payload JSON schema, dedupe key convention, delay/schedule, side effects (rows written, jobs enqueued), idempotency, failure behaviour.
- Machine-readable `packages/shared/src/contracts/jobs.json` (JSON Schema per type) consumed by: TS `enqueue()` (zod built from the schema or hand-written zod + a test that the JSON schema matches), Python `jobs.py` validating payloads on claim (`jsonschema`) and failing fast with a clear `lastError`.
- `docs/contracts/worker-http.md` + `packages/shared/src/contracts/worker-http.json`: `/health`, `/embed-selfie` request/response; TS `face/search/route.ts` validates the worker response with zod derived from it; pytest validates `api.py` responses against the same schema.
- Sync test: TS `JobType` members === keys in `jobs.json` === Python `JOB_TYPES` (vitest reads `jobs.py` text; pytest reads `jobs.json`).

## Out of scope
- Changing any payload shape (document what exists; new fields come with their tickets).

## Acceptance criteria
- [ ] Adding a job type in TS without updating `jobs.json` fails `pnpm test`; adding it in Python without the JSON fails `make test`.
- [ ] Worker rejects a `PROCESS_PHOTO` job with no `photoId` as a non-retryable failure (`maxAttempts` exhausted immediately or status DEAD with a schema error) — pytest.
- [ ] `/embed-selfie` responses validate against the schema in pytest.

## Files
- `docs/contracts/{jobs.md,worker-http.md}`, `packages/shared/src/contracts/{jobs.json,worker-http.json}`, `packages/shared/src/contracts.test.ts` (new), `packages/db/src/index.ts`, `apps/web/src/app/api/face/search/route.ts`
- `workers/media/hub_worker/{jobs.py,api.py}`, `workers/media/tests/test_contracts.py` (new), `workers/media/README.md`

## Verification
```bash
pnpm --filter @hub/shared test
cd workers/media && make test -- -k contracts
```

## Notes for agents
First failing test: the three-way type sync. Keep the JSON schemas small (required keys + types), not exhaustive.
