# ADR-0001: Postgres Job table with FOR UPDATE SKIP LOCKED instead of Redis or SQS

- Status: Accepted
- Date: 2026-10-08
- Tickets: WRK-011, WRK-012, WRK-015, WRK-016

## Context

Background work (derivatives, face indexing, clustering, zips, messages, reminders, purges, print submission) is produced by TypeScript (web, admin) and consumed by the Python worker. docs/01 section 2 asks for a queue with no Redis or SQS dependency that both runtimes can use, and docs/03 decision 12 asks for enqueue in the same transaction as the row that caused the job.

## Decision

The queue is the Prisma `Job` table (`type`, `payload`, `status`, `runAt`, `attempts`, `maxAttempts`, `lockedBy`, `lockedAt`, `lastError`, unique `dedupeKey`). Producers insert rows: `enqueue()` in TypeScript (accepts a `tx`), `enqueue()` in the worker (psycopg). The worker claims one due `QUEUED` row with `FOR UPDATE SKIP LOCKED ORDER BY runAt, id`, runs the handler registered for its `type`, then marks it `SUCCEEDED`, re-queues it with exponential backoff (10 s doubling, capped at 1 h, +-25% jitter), or marks it `DEAD` after `maxAttempts`. Rows locked longer than `STALE_LOCK_S` are re-queued. `runAt` also carries delays, so reminders and purges are future-dated rows polled by the same 1 s loop. `dedupeKey` coalesces repeated work (for example one `CLUSTER_FACES` per upload batch); both `enqueue()` implementations share one documented upsert semantics.

## Consequences

- No new infrastructure: the queue is backed up and migrated with the rest of the data, and a job can never point at a row that was rolled back.
- Throughput is bounded by Postgres and a 1 s poll; fine for 100 to 2,000 photos per event, not for thousands of jobs per second. Revisit if queue depth on the admin Jobs page (`apps/admin/src/app/platform/jobs`) stays high.
- `Job` has no `studioId`; per-tenant visibility of jobs relies on the payload, which matters for ADR-0003.
- Two enqueue implementations must stay in lock-step; a contract test belongs with DOC-013.
- Follow-ups: WRK-015 (use the database clock for `runAt`), WRK-016 (scope stale-lock release), WRK-011 (flaky consumer tests), WRK-012 (scheduler tick for purges).

## Alternatives

- Redis (BullMQ or RQ): a second stateful service to host, and enqueue cannot join the Postgres transaction.
- SQS or another cloud queue: ties deployment to one provider, contradicts the provider-agnostic rule, and has no local equivalent in the compose stack.
- A Node-only consumer: the face and imaging pipeline is Python, so a second runtime would be needed anyway.

## References

- `packages/db/src/index.ts`
- `packages/db/prisma/schema.prisma`
- `workers/media/hub_worker/jobs.py`
- `docs/01-architecture.md` section 2
- `docs/03-data-model.md` decision 12
