# ADR-0001: Postgres Job table with FOR UPDATE SKIP LOCKED instead of Redis or SQS

- Status: Accepted
- Date: 2026-10-08
- Tickets: WRK-012, WRK-015, WRK-016

## Context

Background work (derivatives, face indexing, clustering, zips, messages, reminders, purges, print submission) is produced by TypeScript (web, admin) and consumed by the Python worker. docs/01 section 2 asks for a queue with no Redis or SQS dependency that both runtimes can use; docs/03 decision 12 wants enqueue in the same transaction as the row that caused the job.

## Decision

The queue is the Prisma `Job` table (`type`, `payload`, `status`, `runAt`, `attempts`, `maxAttempts`, `lockedBy`, `lockedAt`, `lastError`, unique `dedupeKey`). Producers insert rows with `enqueue()` in TypeScript or in the worker (psycopg). The worker claims one due `QUEUED` row with `FOR UPDATE SKIP LOCKED ORDER BY runAt, id`, runs the handler for its `type`, then marks it `SUCCEEDED`, re-queues it with exponential backoff (10 s doubling, capped at 1 h, +-25% jitter), or marks it `DEAD` once `maxAttempts` is used up. Rows locked longer than `STALE_LOCK_S` count as a failed attempt and are re-queued, or marked `DEAD` if exhausted. `runAt` carries delays, so reminders and purges are future-dated rows polled by the same 1 s loop. `dedupeKey` coalesces repeated work (one `CLUSTER_FACES` per upload batch).

## Consequences

- No new infrastructure; the queue is backed up and migrated with the rest of the data.
- Transactional enqueue is possible (`enqueue(..., { tx })`) but not yet used: every TypeScript caller in `apps/admin` enqueues after its write, outside a transaction, so a crash between the two loses the job. The TypeScript dedupe path is read-then-write, not atomic, unlike the worker's single upsert.
- Throughput is bounded by Postgres and a 1 s poll; fine for 100 to 2,000 photos per event, not thousands of jobs per second. Revisit if queue depth on the admin Jobs page (`apps/admin/src/app/platform/jobs`) stays high.
- `Job` has no `studioId`; per-tenant visibility relies on the payload.
- Follow-ups: WRK-015 (database clock for `runAt`), WRK-016 (scope stale-lock release), WRK-012 (scheduler tick for purges).

## Alternatives

- Redis (BullMQ or RQ): a second stateful service, and enqueue cannot join the Postgres transaction.
- SQS or another cloud queue: provider lock-in with no local equivalent in the compose stack.
- A Node-only consumer: the face and imaging pipeline is Python.

## References

- `packages/db/src/index.ts`
- `packages/db/prisma/schema.prisma`
- `workers/media/hub_worker/jobs.py`
- `apps/admin/src/app/studios/[studioId]/events/[eventId]/gallery/actions.ts`
- `docs/01-architecture.md` section 2
- `docs/03-data-model.md` decision 12
