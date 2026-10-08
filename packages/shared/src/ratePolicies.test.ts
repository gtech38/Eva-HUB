/**
 * SHR-003 policies: the numbers from the ticket, env overrides, audit on trip, client IP trust.
 * Pure: memory store and a recording audit sink, injected clock.
 */
import { describe, expect, it } from "vitest";
import { hashRateKey, memoryRateLimitStore } from "./ratelimit.ts";
import { clientIp, RATE_LIMITS, ratePolicies, rateLimiter, type RateAuditEntry } from "./ratePolicies.ts";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);

function harness(env: Record<string, string | undefined> = {}) {
  const audits: RateAuditEntry[] = [];
  const limiter = rateLimiter({ store: memoryRateLimitStore(), audit: async (e) => void audits.push(e), env, random: () => 1 });
  return { limiter, audits };
}

describe("RATE_LIMITS defaults (ticket SHR-003)", () => {
  it("match the agreed numbers", () => {
    expect(RATE_LIMITS).toStrictEqual({
      signInAddress: { max: 5, windowSec: 15 * 60 },
      signInIp: { max: 30, windowSec: 15 * 60 },
      otpVerifyAddress: { max: 10, windowSec: 15 * 60 },
      inviteIp: { max: 60, windowSec: 60 * 60 },
      faceSearchUser: { max: 10, windowSec: 60 * 60 },
      faceSearchConcurrent: { max: 3, windowSec: 60 },
      adminMagicLinkAddress: { max: 5, windowSec: 15 * 60 },
    });
  });
});

describe("ratePolicies(env)", () => {
  it("uses the defaults when nothing is set", () => {
    expect(ratePolicies({})).toStrictEqual(RATE_LIMITS);
  });

  it("RATE_LIMIT_<POLICY>=max/windowSec overrides one policy", () => {
    const p = ratePolicies({ RATE_LIMIT_SIGN_IN_ADDRESS: "2/60", RATE_LIMIT_FACE_SEARCH_CONCURRENT: " 1/30 " });
    expect(p.signInAddress).toStrictEqual({ max: 2, windowSec: 60 });
    expect(p.faceSearchConcurrent).toStrictEqual({ max: 1, windowSec: 30 });
    expect(p.signInIp).toStrictEqual(RATE_LIMITS.signInIp);
  });

  it.each(["5", "5/0", "0/60", "-1/60", "a/b", "5/60/1", "1.5/60"])("rejects a malformed override %j loudly", (bad) => {
    expect(() => ratePolicies({ RATE_LIMIT_INVITE_IP: bad })).toThrow(/RATE_LIMIT_INVITE_IP/);
  });
});

describe("rateLimiter().check", () => {
  it("counts per policy and value: one address tripping does not limit another", async () => {
    const { limiter } = harness();
    for (let i = 0; i < 5; i++) expect((await limiter.check("signInAddress", "a@x.test", { now: at(i) })).ok).toBe(true);
    expect((await limiter.check("signInAddress", "a@x.test", { now: at(5) })).ok).toBe(false);
    expect((await limiter.check("signInAddress", "b@x.test", { now: at(6) })).ok).toBe(true);
    expect((await limiter.check("adminMagicLinkAddress", "a@x.test", { now: at(7) })).ok, "policies are separate counters").toBe(true);
  });

  it("writes one auth.rate_limited audit row per trip, with the hashed key and never the raw value", async () => {
    const { limiter, audits } = harness();
    const ctx = { studioId: "studio-1", eventId: "event-1", now: NOW };
    for (let i = 0; i < 8; i++) await limiter.check("signInAddress", "priya@localhost", ctx);
    expect(audits).toStrictEqual([
      {
        action: "auth.rate_limited",
        studioId: "studio-1",
        eventId: "event-1",
        actorUserId: null,
        data: { policy: "signInAddress", key: hashRateKey("signInAddress:priya@localhost"), retryAfterSec: 900 },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("priya");
  });

  it("a null value (client IP unknown) is not limited and not counted", async () => {
    const { limiter, audits } = harness({ RATE_LIMIT_SIGN_IN_IP: "1/60" });
    for (let i = 0; i < 3; i++) expect((await limiter.check("signInIp", null, { now: NOW })).ok).toBe(true);
    expect(audits).toStrictEqual([]);
  });

  it("reads env overrides at call time", async () => {
    const { limiter } = harness({ RATE_LIMIT_INVITE_IP: "1/60" });
    expect((await limiter.check("inviteIp", "203.0.113.9", { now: NOW })).ok).toBe(true);
    expect((await limiter.check("inviteIp", "203.0.113.9", { now: NOW })).ok).toBe(false);
  });

  it("an audit failure does not turn a refusal into a pass", async () => {
    const limiter = rateLimiter({
      store: memoryRateLimitStore(),
      audit: async () => {
        throw new Error("db down");
      },
      env: { RATE_LIMIT_INVITE_IP: "1/60" },
      random: () => 1,
    });
    await limiter.check("inviteIp", "203.0.113.9", { now: NOW });
    expect((await limiter.check("inviteIp", "203.0.113.9", { now: NOW })).ok).toBe(false);
  });
});

describe("rateLimiter().acquire", () => {
  it("faceSearchConcurrent: the 4th concurrent holder is refused and audited once", async () => {
    const { limiter, audits } = harness();
    const ctx = { studioId: "s", eventId: "e", actorUserId: "user-1", now: NOW };
    const held = await Promise.all([1, 2, 3].map(() => limiter.acquire("faceSearchConcurrent", "user-1", ctx)));
    expect(held.every((s) => s.ok)).toBe(true);
    const fourth = await limiter.acquire("faceSearchConcurrent", "user-1", ctx);
    expect(fourth.ok).toBe(false);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "auth.rate_limited", actorUserId: "user-1", data: { policy: "faceSearchConcurrent" } });
    await held[0]!.release();
    expect((await limiter.acquire("faceSearchConcurrent", "user-1", ctx)).ok).toBe(true);
  });
});

describe("clientIp", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("takes the first hop of x-forwarded-for (the client, as written by our reverse proxy)", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.2, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "  2001:db8::1 " }))).toBe("2001:db8::1");
  });

  it("is null when no proxy header is present", () => {
    expect(clientIp(h({}))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": " , 10.0.0.1" }))).toBeNull();
  });
});
