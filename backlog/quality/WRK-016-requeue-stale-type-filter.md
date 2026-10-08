---
id: WRK-016
title: Scope requeue_stale() so tests and partial consumers cannot release others' locks
labels: [type:tech-debt, area:worker, priority:p3, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-QUALITY
depends_on: [WRK-011]
---

## Context
Found while fixing WRK-011 (PR #120): `hub_worker.jobs.requeue_stale()` releases every RUNNING row locked longer than the threshold, regardless of type. `test_stale_lock_release` therefore touches any stale row in the target database, and a consumer started with `only_types` would release locks belonging to job types it does not handle.

## Scope
- Add an optional `only_types` parameter to `requeue_stale()` mirroring `claim()`; the consumer passes its own `only_types` through.
- `test_stale_lock_release` uses its own per-test type.

## Out of scope
- Changing the stale threshold or the attempt-counting rule.

## Acceptance criteria
- [ ] `requeue_stale(conn, only_types=[T])` leaves stale rows of other types RUNNING
- [ ] Without `only_types`, behaviour is unchanged (all stale rows released)
- [ ] The consumer loop forwards its `only_types`

## Files
`workers/media/hub_worker/jobs.py`, `workers/media/tests/test_jobs.py`

## Verification
```bash
cd workers/media && .venv/bin/python -m pytest -q tests/test_jobs.py -k stale
```

## Notes for agents
Red first: a test that seeds a stale RUNNING row of another type and asserts it stays RUNNING after a scoped `requeue_stale`.
