import { createHash } from "node:crypto";
import { prisma as defaultPrisma, Prisma, type PrismaClient } from "@hub/db";

/**
 * Fixed-window rate limiting on Postgres (no Redis by design, SHR-003).
 *
 * `limit(key, { max, windowSec })` counts one hit for `key` and says whether it is within `max` hits
 * per window. The key is stored as sha256(key) only, so callers pass `"<policy>:<value>"` and the raw
 * address / IP never reaches the table. Time is injectable (`now`) so windows are testable without
 * sleeping.
 */

export type RateWindow = { max: number; windowSec: number };

export type LimitResult = {
  ok: boolean;
  /** Hits left in this window after this one. */
  remaining: number;
  /** Seconds until the window resets; 0 when `ok`. */
  retryAfterSec: number;
  /** sha256 of the key: the only form that may be logged or audited. */
  keyHash: string;
  /** True for exactly the first rejected hit of a window (audit once, not on every hit). */
  tripped: boolean;
};

/** The counter after a hit: how many hits this window has seen, and when it ends. */
export type Counter = { count: number; resetAt: Date };

/** Storage seam. Every implementation must count atomically: N concurrent hits yield counts 1..N. */
export interface RateLimitStore {
  /** Count one hit; starts a fresh window of `windowSec` when the current one has ended at `now`. */
  hit(keyHash: string, windowSec: number, now: Date): Promise<Counter>;
  /** Delete windows that ended before `now`. */
  sweep(now: Date): Promise<void>;
}

export type LimitOptions = {
  now?: Date;
  store?: RateLimitStore;
  /** Janitor dice; the sweep runs when `random() < JANITOR_RATE`. */
  random?: () => number;
};

/** Share of `limit()` calls that also delete expired rows. */
export const JANITOR_RATE = 0.01;

export const hashRateKey = (key: string) => createHash("sha256").update(key).digest("hex");

let defaultStore: RateLimitStore | undefined;

export async function limit(key: string, w: RateWindow, opts: LimitOptions = {}): Promise<LimitResult> {
  const now = opts.now ?? new Date();
  const store = opts.store ?? (defaultStore ??= pgRateLimitStore(defaultPrisma));
  const keyHash = hashRateKey(key);
  const { count, resetAt } = await store.hit(keyHash, w.windowSec, now);
  if ((opts.random ?? Math.random)() < JANITOR_RATE) {
    await store.sweep(now).catch((err: unknown) => console.warn("[ratelimit] sweep failed", (err as Error).message));
  }
  const ok = count <= w.max;
  return {
    ok,
    remaining: Math.max(0, w.max - count),
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    keyHash,
    tripped: count === w.max + 1,
  };
}

/**
 * Postgres store. One `INSERT ... ON CONFLICT DO UPDATE` per hit: the row lock taken by the upsert
 * serialises concurrent hits on a key, and the UPDATE re-reads the latest row, so no advisory lock
 * or transaction is needed for the count to be exact.
 */
export function pgRateLimitStore(db: Pick<PrismaClient, "$queryRaw" | "$executeRaw"> = defaultPrisma): RateLimitStore {
  return {
    async hit(keyHash, windowSec, now) {
      const ts = Prisma.sql`${now.toISOString()}::timestamptz`;
      const rows = await db.$queryRaw<Counter[]>(Prisma.sql`
        INSERT INTO "RateLimit" ("key", "count", "resetAt")
        VALUES (${keyHash}, 1, ${ts} + ${windowSec}::int * interval '1 second')
        ON CONFLICT ("key") DO UPDATE SET
          "count"   = CASE WHEN "RateLimit"."resetAt" <= ${ts} THEN 1 ELSE "RateLimit"."count" + 1 END,
          "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${ts} THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
        RETURNING "count", "resetAt"
      `);
      const row = rows[0]!;
      return { count: Number(row.count), resetAt: new Date(row.resetAt) };
    },
    async sweep(now) {
      await db.$executeRaw(Prisma.sql`DELETE FROM "RateLimit" WHERE "resetAt" < ${now.toISOString()}::timestamptz`);
    },
  };
}

/** Single-process store for tests and tools. Not shared across processes: never the production default. */
export function memoryRateLimitStore(): RateLimitStore {
  const rows = new Map<string, Counter>();
  return {
    async hit(keyHash, windowSec, now) {
      const cur = rows.get(keyHash);
      const next =
        !cur || cur.resetAt.getTime() <= now.getTime()
          ? { count: 1, resetAt: new Date(now.getTime() + windowSec * 1000) }
          : { count: cur.count + 1, resetAt: cur.resetAt };
      rows.set(keyHash, next);
      return { ...next };
    },
    async sweep(now) {
      for (const [k, v] of rows) if (v.resetAt.getTime() < now.getTime()) rows.delete(k);
    },
  };
}
