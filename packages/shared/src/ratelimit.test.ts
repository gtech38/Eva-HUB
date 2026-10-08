/**
 * SHR-003: fixed-window rate limits and concurrency leases.
 *
 * The same contract runs against the in-memory store and the Postgres store (Liskov: callers cannot
 * tell them apart). Time is injected through `now`; nothing sleeps. The Postgres suite needs the
 * local stack (pnpm infra:up): skipped with a message locally, and FAILS when CI is set, so a green
 * CI run means the atomicity test ran. Every key is prefixed with a per-run marker so the file is
 * rerunnable without db:reset.
 */
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { acquireSlot, hashRateKey, limit, memoryRateLimitStore, pgRateLimitStore, SWEEP_BATCH, type RateLimitStore } from "./ratelimit.ts";

const SECRET = "test-ratelimit-secret-0123456789";
process.env.AUTH_SECRET = SECRET; // limit() reads the HMAC key at call time

const run = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = []; // hashes written by this run, deleted in afterAll
const key = (s: string) => {
  const k = `${run}:${s}`;
  created.push(hashRateKey(k, SECRET));
  return k;
};
const NOW = new Date("2026-10-08T12:00:00.000Z");
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);
const never = () => 1; // janitor off unless a test asks for it

const dbUp = await prisma.$queryRaw`SELECT 1 FROM "RateLimit" LIMIT 1`.then(
  () => true,
  () => false,
);
const skipReason = "Postgres (with the RateLimit table) unreachable at DATABASE_URL; run pnpm infra:up && pnpm db:migrate";
const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);
if (!dbUp && inCi) {
  describe("limit() against Postgres", () => {
    it("requires Postgres when CI is set", () => {
      throw new Error(skipReason);
    });
  });
} else if (!dbUp) console.log(`# packages/shared ratelimit: ${skipReason} -- skipping the Postgres store`);

describe("key hashing", () => {
  it("keys are HMAC-SHA256 under AUTH_SECRET, not a plain (dictionary-reversible) sha256", async () => {
    const k = "signInAddress:priya@localhost";
    const plain = createHash("sha256").update(k).digest("hex");
    expect(hashRateKey(k, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRateKey(k, SECRET)).not.toBe(plain);
    expect(hashRateKey(k, SECRET)).not.toBe(hashRateKey(k, "another-secret-0123456789"));
    const r = await limit(k, { max: 1, windowSec: 60 }, { store: memoryRateLimitStore(), now: NOW, random: never });
    expect(r.keyHash).toBe(hashRateKey(k, SECRET));
  });

  it("refuses to run without a usable secret", async () => {
    await expect(limit("k", { max: 1, windowSec: 60 }, { store: memoryRateLimitStore(), secret: "short" })).rejects.toThrow(/AUTH_SECRET/);
  });
});

afterAll(async () => {
  if (dbUp) await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "key" = ANY(${created})`;
  await prisma.$disconnect();
});

const stores: Array<[string, () => RateLimitStore, boolean]> = [
  ["memory store", () => memoryRateLimitStore(), true],
  [dbUp ? "Postgres store" : `Postgres store [skipped: ${skipReason}]`, () => pgRateLimitStore(prisma), dbUp],
];

for (const [name, makeStore, enabled] of stores) {
  describe.skipIf(!enabled)(`limit() on the ${name}`, () => {
    it("5 calls pass, the 6th within the window returns ok: false with retryAfterSec > 0; after resetAt it passes again", async () => {
      const store = makeStore();
      const k = key(`${name}:sixth`);
      const w = { max: 5, windowSec: 900 };

      const first5 = [];
      for (let i = 0; i < 5; i++) first5.push(await limit(k, w, { store, now: at(i * 10), random: never }));
      expect(first5.map((r) => r.ok)).toStrictEqual([true, true, true, true, true]);
      expect(first5.map((r) => r.remaining)).toStrictEqual([4, 3, 2, 1, 0]);

      const sixth = await limit(k, w, { store, now: at(60), random: never });
      expect(sixth.ok).toBe(false);
      expect(sixth.remaining).toBe(0);
      expect(sixth.retryAfterSec).toBe(900 - 60);

      const justBefore = await limit(k, w, { store, now: at(899), random: never });
      expect(justBefore.ok).toBe(false);
      expect(justBefore.retryAfterSec).toBe(1);

      const afterReset = await limit(k, w, { store, now: at(900), random: never });
      expect(afterReset).toMatchObject({ ok: true, remaining: 4, retryAfterSec: 0 });
    });

    it("trips exactly once per window: only the first rejected hit has tripped = true", async () => {
      const store = makeStore();
      const k = key(`${name}:trip`);
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await limit(k, { max: 2, windowSec: 60 }, { store, now: at(i), random: never }));
      expect(results.map((r) => r.tripped)).toStrictEqual([false, false, true, false, false]);
      const nextWindow = [];
      for (let i = 0; i < 3; i++) nextWindow.push(await limit(k, { max: 2, windowSec: 60 }, { store, now: at(60 + i), random: never }));
      expect(nextWindow.map((r) => r.tripped)).toStrictEqual([false, false, true]);
    });

    it("the janitor sweeps windows that have ended, and only those", async () => {
      const store = makeStore();
      const old = key(`${name}:janitor-old`);
      const live = key(`${name}:janitor-live`);
      await limit(old, { max: 1, windowSec: 10 }, { store, now: at(0), random: never });
      await limit(live, { max: 1, windowSec: 1000 }, { store, now: at(0), random: never });
      // The dice say "sweep" at t=20: `old` ended at t=10, `live` runs until t=1000.
      await limit(key(`${name}:janitor-trigger`), { max: 1, windowSec: 1000 }, { store, now: at(20), random: () => 0 });
      expect((await limit(old, { max: 1, windowSec: 10 }, { store, now: at(5), random: never })).ok, "old window was deleted, so a fresh one starts").toBe(true);
      expect((await limit(live, { max: 1, windowSec: 1000 }, { store, now: at(21), random: never })).ok, "live window kept its count").toBe(false);
    });
  });

  describe.skipIf(!enabled)(`acquireSlot() on the ${name}`, () => {
    const lease = { max: 3, windowSec: 60 };

    it("allows max concurrent holders, refuses the next, and frees a slot on release", async () => {
      const store = makeStore();
      const k = key(`${name}:slots`);
      const held = [];
      for (let i = 0; i < 3; i++) held.push(await acquireSlot(k, lease, { store, now: at(i) }));
      expect(held.map((s) => s.ok)).toStrictEqual([true, true, true]);

      const fourth = await acquireSlot(k, lease, { store, now: at(3) });
      expect(fourth.ok).toBe(false);
      expect(fourth.retryAfterSec).toBeGreaterThan(0);
      await fourth.release(); // a refused slot's release is a no-op, so it cannot free someone else's

      expect((await acquireSlot(k, lease, { store, now: at(4) })).ok, "still full").toBe(false);
      await held[0]!.release();
      await held[0]!.release(); // releasing twice frees one slot, not two
      const next = await acquireSlot(k, lease, { store, now: at(5) });
      expect(next.ok).toBe(true);
      expect((await acquireSlot(k, lease, { store, now: at(6) })).ok).toBe(false);
    });

    it("leases held by a crashed process expire windowSec after the last granted acquire", async () => {
      const store = makeStore();
      const k = key(`${name}:stale`);
      for (let i = 0; i < 3; i++) await acquireSlot(k, lease, { store, now: at(i * 10) }); // never released
      // Every granted acquire pushes the lease out to now + windowSec (last one: t=20 -> t=80).
      // Refused attempts must not keep a dead lease alive, or a retrying client would lock itself out.
      const refused = await acquireSlot(k, lease, { store, now: at(30) });
      expect(refused).toMatchObject({ ok: false, retryAfterSec: 50 });
      expect((await acquireSlot(k, lease, { store, now: at(79) })).ok).toBe(false);
      expect((await acquireSlot(k, lease, { store, now: at(80) })).ok).toBe(true);
    });
  });
}

describe.skipIf(!dbUp)(dbUp ? "limit() on Postgres only" : `limit() on Postgres only [skipped: ${skipReason}]`, () => {
  const store = pgRateLimitStore(prisma);

  it("50 parallel limit() calls on one key never exceed max successes (Postgres atomicity)", async () => {
    const k = key("parallel");
    const results = await Promise.all(Array.from({ length: 50 }, () => limit(k, { max: 7, windowSec: 60 }, { store, now: NOW, random: never })));
    expect(results.filter((r) => r.ok)).toHaveLength(7);
    expect(results.filter((r) => r.tripped)).toHaveLength(1);
    const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT "count" FROM "RateLimit" WHERE "key" = ${hashRateKey(k, SECRET)}`;
    expect(row?.count, "every hit counted exactly once").toBe(50);
  });

  it("20 parallel acquireSlot() calls grant exactly max slots", async () => {
    const k = key("parallel-slots");
    const slots = await Promise.all(Array.from({ length: 20 }, () => acquireSlot(k, { max: 3, windowSec: 60 }, { store, now: NOW })));
    expect(slots.filter((s) => s.ok)).toHaveLength(3);
    await Promise.all(slots.map((s) => s.release()));
    const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT "count" FROM "RateLimit" WHERE "key" = ${hashRateKey(k, SECRET)}`;
    expect(row?.count, "all granted slots returned, refused ones never counted").toBe(0);
  });

  it("stores HMAC(key), never the raw address", async () => {
    const k = key("signInAddress:priya@localhost");
    const r = await limit(k, { max: 5, windowSec: 60 }, { store, now: NOW, random: never });
    expect(r.keyHash).toBe(hashRateKey(k, SECRET));
    const raw = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "RateLimit" WHERE "key" LIKE ${`%${run}%`}`;
    expect(raw).toStrictEqual([]);
  });

  it(`one janitor sweep deletes at most SWEEP_BATCH (${SWEEP_BATCH}) expired rows`, async () => {
    const prefix = `${run}-sweep-`;
    const n = SWEEP_BATCH + 100;
    try {
      await prisma.$executeRaw`
        INSERT INTO "RateLimit" ("key", "count", "resetAt")
        SELECT ${prefix} || g, 1, ${NOW.toISOString()}::timestamptz - interval '1 hour' FROM generate_series(1, ${n}::int) g`;
      await store.sweep(NOW);
      const [left] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "RateLimit" WHERE "key" LIKE ${`${prefix}%`}`;
      expect(left!.n).toBeGreaterThanOrEqual(n - SWEEP_BATCH);
    } finally {
      await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "key" LIKE ${`${prefix}%`}`;
    }
  });
});
