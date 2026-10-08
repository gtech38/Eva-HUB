---
id: WRK-011
title: Fix flaky consumer tests in workers/media/tests/test_jobs.py on CI
labels: [type:tech-debt, area:worker, priority:p1, size:S, agent-ready]
milestone: Phase 0 — Foundations
epic: EPIC-QUALITY
depends_on: []
---

## Context
CI run 37808444649 (PR #117) failed `test_unknown_type_is_a_failure` (read `QUEUED`, expected `DEAD`) and `test_requeue_does_not_count_as_attempt` (`lastError` was `None`) while the worker log in the same run shows the job going DEAD. A re-run with no code change passed, and the suite passes locally on a fresh database. The tests share one module-scoped connection and claim "oldest runnable TEST_* job" across tests, so leftovers or ordering can make a test observe a different row than the one it enqueued.

## Scope
- Give each test its own job type (e.g. `TEST_UNKNOWN_<uuid8>`) or pass `only_types=[that_type]` so `_drain` can only claim the row under test.
- Assert on the row returned by `run_once` (id match) before reading it back.
- Clean up per test (fixture) rather than once per module.
- Reproduce first: loop the module 50× locally (`for i in $(seq 50); do .venv/bin/pytest -q tests/test_jobs.py || break; done`) and record whether it fails without the fix.

## Out of scope
- Changing consumer semantics in `hub_worker/jobs.py`.

## Acceptance criteria
- [ ] `tests/test_jobs.py` passes 50 consecutive local runs
- [ ] Each test claims only rows it created (asserted by id)
- [ ] No module-level shared QUEUED rows survive a test

## Files
`workers/media/tests/test_jobs.py`, `workers/media/hub_worker/jobs.py` (read only)

## Verification
```bash
cd workers/media && for i in $(seq 50); do .venv/bin/pytest -q tests/test_jobs.py || exit 1; done
```

## Notes for agents
Red first: the 50× loop is the failing test. If it never fails locally, make the isolation change anyway; the CI evidence above is the red.
