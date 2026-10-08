---
id: WRK-015
title: Default job runAt from the database clock, not the client clock
labels: [type:tech-debt, area:worker, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-QUALITY
depends_on: [WRK-011]
---

## Context
Root cause of WRK-011 (PR #120): `hub_worker.jobs.enqueue()` and the TS `enqueue()` in `packages/db/src/index.ts` compute the default `runAt` on the client. The value has microseconds; `Job.runAt` is `timestamp(3)`, so Postgres can round it *up* by up to 0.5 ms, and client/DB clock skew adds more. A job enqueued "now" can therefore be not-yet-due for the claim query (`"runAt" <= now()`), which is what made the CI tests flaky.

## Scope
- Python: when no delay/runAt is given, insert `runAt = now()` (DB clock); for a delay use `now() + make_interval(secs => %s)`.
- TS: omit `runAt` when the caller did not pass one so the column default (`now()`) applies; when coalescing a QUEUED row keep the GREATEST rule.
- Keep explicit caller-provided `runAt` values unchanged.

## Out of scope
- Changing the claim query or consumer semantics.

## Acceptance criteria
- [ ] A job enqueued with no runAt/delay is claimable by an immediate `run_once` 1000 times in a row (no retry loop)
- [ ] An explicit runAt is stored exactly (to the millisecond) in both TS and Python
- [ ] Dedupe semantics (GREATEST while QUEUED, reset otherwise) unchanged — existing tests still pass

## Files
`workers/media/hub_worker/jobs.py`, `workers/media/tests/test_jobs.py`, `packages/db/src/index.ts`, `packages/db/src/index.test.ts`

## Verification
```bash
cd workers/media && .venv/bin/python -m pytest -q tests/test_jobs.py
pnpm --filter @hub/db test
```

## Notes for agents
Red first: an immediate-claim loop test (1000 iterations, no retry) fails intermittently on the current code once the client clock is skewed +1 ms (monkeypatch the clock the way PR #120's repro plugin did).
