import { PrismaClient, Prisma } from "@prisma/client";

export * from "@prisma/client";
export { Prisma };

declare global {
  // eslint-disable-next-line no-var
  var __hubPrisma: PrismaClient | undefined;
}

/**
 * Single Prisma client per process. Next.js dev hot-reload re-evaluates modules,
 * so the instance is cached on globalThis to avoid exhausting connections.
 */
export const prisma: PrismaClient =
  globalThis.__hubPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalThis.__hubPrisma = prisma;

/**
 * Tenant scope. Every event-owned query in app code should go through
 * `scoped(ctx)` so a missing `where: { eventId }` is a type error, not a leak.
 *
 * This is deliberately small for the POC: it returns helpers that pre-bind
 * studioId / eventId. Postgres RLS is a Phase 3 addition (see docs/04-plan.md).
 */
export type TenantContext = { studioId: string; eventId?: string };

export function scoped(ctx: TenantContext) {
  const event = ctx.eventId
    ? { eventId: ctx.eventId }
    : (undefined as never); // forces callers to provide eventId for event tables

  return {
    ctx,
    /** where-fragment for tables that carry both studioId and eventId */
    whereEvent: <T extends object>(where: T = {} as T) => ({
      ...where,
      studioId: ctx.studioId,
      ...event,
    }),
    /** where-fragment for tables that only carry eventId */
    whereEventOnly: <T extends object>(where: T = {} as T) => ({
      ...where,
      ...event,
    }),
    /** where-fragment for studio-level tables */
    whereStudio: <T extends object>(where: T = {} as T) => ({
      ...where,
      studioId: ctx.studioId,
    }),
  };
}

// ───────────────────────── Job queue ─────────────────────────

export type JobType =
  | "PROCESS_PHOTO"
  | "INDEX_FACES"
  | "CLUSTER_FACES"
  | "BUILD_ZIP"
  | "SEND_MESSAGE"
  | "FIRE_REMINDER"
  | "PURGE_FACE_INDEX"
  | "PRINT_SUBMIT";

export async function enqueue(
  type: JobType,
  payload: Prisma.InputJsonValue,
  opts: { runAt?: Date; dedupeKey?: string; tx?: Prisma.TransactionClient } = {},
) {
  const db = opts.tx ?? prisma;
  if (opts.dedupeKey) {
    // Coalescing enqueue. ONE semantics, shared with the worker's ON CONFLICT upsert
    // (workers/media/hub_worker/jobs.py `enqueue`) -- keep the two in lock-step:
    //   * no row            -> insert
    //   * QUEUED            -> payload refreshed; runAt = GREATEST(existing, new); attempts kept
    //   * SUCCEEDED/FAILED/DEAD -> reset to QUEUED; runAt = new; attempts = 0
    //   * RUNNING           -> untouched (returned as-is; the worker returns None)
    //   * always on update  -> lastError/finishedAt/lockedBy/lockedAt cleared; `type` is NOT changed
    // Unlike the worker this is read-then-write, not a single upsert; pass `tx` when that matters.
    // The same semantics are copied as SQL into docs/ops/replay-after-restore.sql and
    // docs/ops/runbook-restore.md (restore contract, DOC-003); change them together.
    const runAt = opts.runAt ?? new Date();
    const existing = await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
    if (!existing) {
      return db.job.create({ data: { type, payload, runAt, dedupeKey: opts.dedupeKey } });
    }
    if (existing.status === "RUNNING") return existing;
    const queued = existing.status === "QUEUED";
    return db.job.update({
      where: { id: existing.id },
      data: {
        payload,
        status: "QUEUED",
        runAt: queued && existing.runAt > runAt ? existing.runAt : runAt,
        attempts: queued ? existing.attempts : 0,
        lastError: null,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
      },
    });
  }
  return db.job.create({ data: { type, payload, runAt: opts.runAt ?? new Date() } });
}
