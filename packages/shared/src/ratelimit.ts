import { createHmac } from "node:crypto";
import { prisma as defaultPrisma, Prisma, type PrismaClient } from "@hub/db";

/**
 * Fixed-window rate limiting on Postgres (no Redis by design, SHR-003).
 *
 * `limit(key, { max, windowSec })` counts one hit for `key` and says whether it is within `max` hits
 * per window. The key is stored as HMAC-SHA256(subkey, key) only, with the subkey derived from
 * AUTH_SECRET under a purpose label (domain separation from the session cookie), so callers pass
 * `"<policy>:<value>"` and neither the raw address / IP nor a dictionary-reversible plain hash of it
 * reaches the table or the audit log. Time is injectable (`now`) so windows are testable without
 * sleeping.
 *
 * Accepted limitations: windows are computed from the app server's clock (`now`), so servers whose
 * clocks disagree by a few seconds see slightly different window edges; and a lease holder slower than
 * the lease TTL can, after the lease lapses and restarts, release a slot it no longer counts in, so
 * concurrency can briefly undercount. Both err by seconds / one slot, not by orders of magnitude.
 */

export type RateWindow = { max: number; windowSec: number };

export type LimitResult = {
  ok: boolean;
  /** Hits left in this window after this one. */
  remaining: number;
  /** Seconds until the window resets; 0 when `ok`. */
  retryAfterSec: number;
  /** HMAC of the key: the only form that may be logged or audited. */
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
  /**
   * Take one of `max` concurrency slots. Granted: holders + 1 and the lease moves to now + ttlSec.
   * Refused: nothing changes, `resetAt` says when the current lease lapses. A lapsed lease (holders
   * that crashed without releasing) restarts at one holder.
   */
  lease(keyHash: string, max: number, ttlSec: number, now: Date): Promise<{ granted: boolean; resetAt: Date }>;
  /** Give back one slot (never below zero). */
  release(keyHash: string): Promise<void>;
  /** Delete at most `SWEEP_BATCH` windows that ended before `now`. */
  sweep(now: Date): Promise<void>;
}

export type LimitOptions = {
  now?: Date;
  store?: RateLimitStore;
  /** Janitor dice; the sweep runs when `random() < JANITOR_RATE`. */
  random?: () => number;
  /** HMAC key; defaults to AUTH_SECRET. */
  secret?: string;
};

/** Share of `limit()` calls that also delete expired rows. */
export const JANITOR_RATE = 0.01;
/** Upper bound on rows one sweep deletes, so the 1 % of callers that sweep pay a bounded cost. */
export const SWEEP_BATCH = 500;

/** Purpose label for the subkey: AUTH_SECRET also signs session cookies, so it is never used directly here. */
const SUBKEY_LABEL = "hub:rate-limit-key:v1";
const subkeys = new Map<string, Buffer>();

export function hashRateKey(key: string, secret: string): string {
  if (secret.length < 16) throw new Error("rate limit keys need AUTH_SECRET (at least 16 characters)");
  let subkey = subkeys.get(secret);
  if (!subkey) subkeys.set(secret, (subkey = createHmac("sha256", secret).update(SUBKEY_LABEL).digest()));
  return createHmac("sha256", subkey).update(key).digest("hex");
}

const secretOf = (opts: { secret?: string }) => opts.secret ?? process.env.AUTH_SECRET ?? "";

let defaultStore: RateLimitStore | undefined;

export async function limit(key: string, w: RateWindow, opts: LimitOptions = {}): Promise<LimitResult> {
  const now = opts.now ?? new Date();
  const store = opts.store ?? (defaultStore ??= pgRateLimitStore(defaultPrisma));
  const keyHash = hashRateKey(key, secretOf(opts));
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

export type Slot = Omit<LimitResult, "remaining" | "tripped"> & {
  /** Give the slot back. Idempotent; a no-op for a refused slot. Call it in `finally`. */
  release(): Promise<void>;
};

/**
 * Concurrency limit: at most `max` holders of `key` at once. `windowSec` is the lease TTL, the
 * safety net for holders that die without releasing; keep it above the longest legitimate hold.
 */
export async function acquireSlot(key: string, w: RateWindow, opts: Omit<LimitOptions, "random"> = {}): Promise<Slot> {
  const now = opts.now ?? new Date();
  const store = opts.store ?? (defaultStore ??= pgRateLimitStore(defaultPrisma));
  const keyHash = hashRateKey(key, secretOf(opts));
  const { granted, resetAt } = await store.lease(keyHash, w.max, w.windowSec, now);
  let held = granted;
  return {
    ok: granted,
    retryAfterSec: granted ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    keyHash,
    async release() {
      if (!held) return;
      held = false;
      await store.release(keyHash);
    },
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
    async lease(keyHash, max, ttlSec, now) {
      const ts = Prisma.sql`${now.toISOString()}::timestamptz`;
      // The DO UPDATE ... WHERE makes a refusal a no-op that returns no row; one statement either way.
      const rows = await db.$queryRaw<Array<{ resetAt: Date }>>(Prisma.sql`
        INSERT INTO "RateLimit" ("key", "count", "resetAt")
        VALUES (${keyHash}, 1, ${ts} + ${ttlSec}::int * interval '1 second')
        ON CONFLICT ("key") DO UPDATE SET
          "count"   = CASE WHEN "RateLimit"."resetAt" <= ${ts} THEN 1 ELSE "RateLimit"."count" + 1 END,
          "resetAt" = EXCLUDED."resetAt"
        WHERE "RateLimit"."resetAt" <= ${ts} OR "RateLimit"."count" < ${max}::int
        RETURNING "resetAt"
      `);
      if (rows[0]) return { granted: true, resetAt: new Date(rows[0].resetAt) };
      // Refused: read when the lease lapses, for Retry-After only (not part of the decision).
      const cur = await db.$queryRaw<Array<{ resetAt: Date }>>(Prisma.sql`SELECT "resetAt" FROM "RateLimit" WHERE "key" = ${keyHash}`);
      return { granted: false, resetAt: cur[0] ? new Date(cur[0].resetAt) : now };
    },
    async release(keyHash) {
      await db.$executeRaw(Prisma.sql`UPDATE "RateLimit" SET "count" = GREATEST("count" - 1, 0) WHERE "key" = ${keyHash}`);
    },
    async sweep(now) {
      // Bounded and index-driven (RateLimit_resetAt_idx); SKIP LOCKED never waits on a row in use.
      await db.$executeRaw(Prisma.sql`
        DELETE FROM "RateLimit" WHERE "key" IN (
          SELECT "key" FROM "RateLimit" WHERE "resetAt" < ${now.toISOString()}::timestamptz
          LIMIT ${SWEEP_BATCH}::int FOR UPDATE SKIP LOCKED
        )`);
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
    async lease(keyHash, max, ttlSec, now) {
      const cur = rows.get(keyHash);
      const lapsed = !cur || cur.resetAt.getTime() <= now.getTime();
      if (!lapsed && cur.count >= max) return { granted: false, resetAt: cur.resetAt };
      const resetAt = new Date(now.getTime() + ttlSec * 1000);
      rows.set(keyHash, { count: lapsed ? 1 : cur.count + 1, resetAt });
      return { granted: true, resetAt };
    },
    async release(keyHash) {
      const cur = rows.get(keyHash);
      if (cur) rows.set(keyHash, { ...cur, count: Math.max(0, cur.count - 1) });
    },
    async sweep(now) {
      let n = 0;
      for (const [k, v] of rows) {
        if (n >= SWEEP_BATCH) break;
        if (v.resetAt.getTime() < now.getTime()) (rows.delete(k), n++);
      }
    },
  };
}
