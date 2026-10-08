/**
 * SHR-003 policies: the agreed numbers, bounded env overrides validated once, audit on trip.
 * Pure: memory store and a recording audit sink, injected clock. (Client IP: clientIp.test.ts.)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashRateKey, memoryRateLimitStore } from "./ratelimit.ts";
import {
  addressAtIp,
  envName,
  exitOnInvalidRateLimitConfig,
  RATE_LIMITS,
  ratePolicies,
  rateLimiter,
  validateRateLimitConfig,
  type RateAuditEntry,
  type RatePolicy,
} from "./ratePolicies.ts";

const SECRET = "test-policies-secret-0123456789";
const NOW = new Date("2026-10-08T12:00:00.000Z");
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);

function harness(env: Record<string, string | undefined> = {}) {
  const audits: RateAuditEntry[] = [];
  const limiter = rateLimiter({ store: memoryRateLimitStore(), audit: async (e) => void audits.push(e), env, random: () => 1, secret: SECRET });
  return { limiter, audits };
}

describe("RATE_LIMITS defaults (ticket SHR-003 + review)", () => {
  it("match the agreed numbers", () => {
    expect(RATE_LIMITS).toStrictEqual({
      signInIp: { max: 60, windowSec: 15 * 60 },
      signInAddressIp: { max: 5, windowSec: 15 * 60 },
      signInAddress: { max: 20, windowSec: 15 * 60 },
      otpVerifyAddress: { max: 10, windowSec: 15 * 60 },
      inviteIp: { max: 200, windowSec: 60 * 60 },
      faceSearchUser: { max: 10, windowSec: 60 * 60 },
      faceSearchConcurrent: { max: 3, windowSec: 60 },
      adminMagicLinkIp: { max: 60, windowSec: 15 * 60 },
      adminMagicLinkAddressIp: { max: 5, windowSec: 15 * 60 },
      adminMagicLinkAddress: { max: 20, windowSec: 15 * 60 },
    });
  });
});

describe("ratePolicies(env)", () => {
  it("uses the defaults when nothing is set", () => {
    expect(ratePolicies({})).toStrictEqual(RATE_LIMITS);
  });

  it("RATE_LIMIT_<POLICY>=max/windowSec overrides one policy", () => {
    const p = ratePolicies({ RATE_LIMIT_SIGN_IN_ADDRESS_IP: "2/60", RATE_LIMIT_FACE_SEARCH_CONCURRENT: " 1/30 " });
    expect(p.signInAddressIp).toStrictEqual({ max: 2, windowSec: 60 });
    expect(p.faceSearchConcurrent).toStrictEqual({ max: 1, windowSec: 30 });
    expect(p.signInIp).toStrictEqual(RATE_LIMITS.signInIp);
  });

  it.each(["5", "5/0", "0/60", "-1/60", "a/b", "5/60/1", "1.5/60", "1000001/60", "5/604801", "99999999999/60"])(
    "rejects a malformed or out-of-bounds override %j loudly",
    (bad) => {
      expect(() => ratePolicies({ RATE_LIMIT_INVITE_IP: bad })).toThrow(/RATE_LIMIT_INVITE_IP/);
    },
  );
});

describe("env reference", () => {
  it("every RATE_LIMIT_* override and TRUSTED_PROXY_HOPS is declared in env.ts, so docs/deploy/env.md lists it", () => {
    const schema = readFileSync(fileURLToPath(new URL("./env.ts", import.meta.url)), "utf8");
    for (const name of [...(Object.keys(RATE_LIMITS) as RatePolicy[]).map(envName), "TRUSTED_PROXY_HOPS"]) {
      expect(schema, name).toMatch(new RegExp(`^  ${name}: z\\.`, "m"));
    }
  });
});

describe("validateRateLimitConfig (called at server boot)", () => {
  it("passes for the defaults and throws for a bad override or a bad TRUSTED_PROXY_HOPS", () => {
    expect(() => validateRateLimitConfig({})).not.toThrow();
    expect(() => validateRateLimitConfig({ RATE_LIMIT_SIGN_IN_IP: "lots" })).toThrow(/RATE_LIMIT_SIGN_IN_IP/);
    expect(() => validateRateLimitConfig({ TRUSTED_PROXY_HOPS: "0" })).toThrow(/TRUSTED_PROXY_HOPS/);
  });

  it("validates TRUSTED_PROXY_HOPS with the same rule as env() (1..10 integer, blank = default)", () => {
    expect(() => validateRateLimitConfig({ TRUSTED_PROXY_HOPS: " 2 " })).not.toThrow();
    expect(() => validateRateLimitConfig({ TRUSTED_PROXY_HOPS: "" })).not.toThrow();
    for (const bad of ["11", "1.5", "two", "-1"]) expect(() => validateRateLimitConfig({ TRUSTED_PROXY_HOPS: bad }), bad).toThrow(/TRUSTED_PROXY_HOPS/);
  });

  it("exitOnInvalidRateLimitConfig stops the process (exit 1) with the reason logged; a good config does nothing", () => {
    const calls: Array<string | number> = [];
    const deps = { exit: (code: number) => void calls.push(code), log: (m: string) => void calls.push(m) };
    exitOnInvalidRateLimitConfig({ RATE_LIMIT_INVITE_IP: "nope" }, deps);
    expect(calls).toHaveLength(2);
    expect(String(calls[0])).toMatch(/RATE_LIMIT_INVITE_IP/);
    expect(calls[1]).toBe(1);
    calls.length = 0;
    exitOnInvalidRateLimitConfig({}, deps);
    expect(calls).toStrictEqual([]);
  });

  it("a limiter parses its overrides once, at construction, not per request", () => {
    expect(() => rateLimiter({ env: { RATE_LIMIT_INVITE_IP: "nope" }, secret: SECRET })).toThrow(/RATE_LIMIT_INVITE_IP/);
  });
});

describe("rateLimiter().check", () => {
  it("counts per policy and value: one address tripping does not limit another", async () => {
    const { limiter } = harness();
    for (let i = 0; i < 20; i++) expect((await limiter.check("signInAddress", "a@x.test", { now: at(i) })).ok).toBe(true);
    expect((await limiter.check("signInAddress", "a@x.test", { now: at(20) })).ok).toBe(false);
    expect((await limiter.check("signInAddress", "b@x.test", { now: at(21) })).ok).toBe(true);
    expect((await limiter.check("adminMagicLinkAddress", "a@x.test", { now: at(22) })).ok, "policies are separate counters").toBe(true);
  });

  it("addressAtIp keys the strict limit on the pair, so another network keeps its own budget", async () => {
    const { limiter } = harness();
    for (let i = 0; i < 5; i++) await limiter.check("signInAddressIp", addressAtIp("a@x.test", "6.6.6.6"), { now: NOW });
    expect((await limiter.check("signInAddressIp", addressAtIp("a@x.test", "6.6.6.6"), { now: NOW })).ok).toBe(false);
    expect((await limiter.check("signInAddressIp", addressAtIp("a@x.test", "203.0.113.9"), { now: NOW })).ok).toBe(true);
  });

  it("writes one auth.rate_limited audit row per trip, with the HMAC key and never the raw value", async () => {
    const { limiter, audits } = harness();
    const ctx = { studioId: "studio-1", eventId: "event-1", now: NOW };
    for (let i = 0; i < 8; i++) await limiter.check("signInAddressIp", "priya@localhost", ctx);
    expect(audits).toStrictEqual([
      {
        action: "auth.rate_limited",
        studioId: "studio-1",
        eventId: "event-1",
        actorUserId: null,
        data: { policy: "signInAddressIp", key: hashRateKey("signInAddressIp:priya@localhost", SECRET), retryAfterSec: 900 },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("priya");
  });

  it("a null value (development, no proxy header) is not limited, and the result serialises cleanly", async () => {
    const { limiter, audits } = harness({ RATE_LIMIT_SIGN_IN_IP: "1/60" });
    for (let i = 0; i < 3; i++) {
      const r = await limiter.check("signInIp", null, { now: NOW });
      expect(r.ok).toBe(true);
      expect(JSON.parse(JSON.stringify(r)).remaining).toBeTypeOf("number");
    }
    expect(audits).toStrictEqual([]);
  });

  it("an audit failure does not turn a refusal into a pass", async () => {
    const limiter = rateLimiter({
      store: memoryRateLimitStore(),
      audit: async () => {
        throw new Error("db down");
      },
      env: { RATE_LIMIT_INVITE_IP: "1/60" },
      random: () => 1,
      secret: SECRET,
    });
    await limiter.check("inviteIp", "203.0.113.9", { now: NOW });
    expect((await limiter.check("inviteIp", "203.0.113.9", { now: NOW })).ok).toBe(false);
  });
});

describe("rateLimiter().acquire", () => {
  it("faceSearchConcurrent: refusals are audited once per lease window, not once per request", async () => {
    const { limiter, audits } = harness();
    const ctx = { studioId: "s", eventId: "e", actorUserId: "user-1", now: NOW };
    const held = await Promise.all([1, 2, 3].map(() => limiter.acquire("faceSearchConcurrent", "user-1", ctx)));
    expect(held.every((s) => s.ok)).toBe(true);
    for (let i = 0; i < 4; i++) expect((await limiter.acquire("faceSearchConcurrent", "user-1", { ...ctx, now: at(i) })).ok).toBe(false);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "auth.rate_limited", actorUserId: "user-1", data: { policy: "faceSearchConcurrent" } });

    // A new window (lease TTL 60 s) audits again on its first refusal.
    for (let i = 0; i < 3; i++) await limiter.acquire("faceSearchConcurrent", "user-1", { ...ctx, now: at(61 + i) });
    await limiter.acquire("faceSearchConcurrent", "user-1", { ...ctx, now: at(65) });
    await limiter.acquire("faceSearchConcurrent", "user-1", { ...ctx, now: at(66) });
    expect(audits).toHaveLength(2);

    await held[0]!.release();
  });
});
