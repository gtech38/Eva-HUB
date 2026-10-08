/**
 * SHR-003: invitation-link hits are limited per client IP (60/h) before the token is looked up, so
 * the limited answer is the same for valid, revoked and made-up tokens. Prisma and the site context
 * are faked; limits run on the real policy numbers over an in-memory store. (The Postgres-backed
 * ADM-005 behaviour lives in route.test.ts.)
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ lookups: 0 }));
vi.mock("@hub/db", async (importActual) => {
  const actual = await importActual<typeof import("@hub/db")>();
  return {
    ...actual,
    prisma: {
      inviteToken: {
        findUnique: async () => {
          db.lookups++;
          return null; // every token in this file is dead: the limit must not care
        },
      },
    },
  };
});

vi.mock("@/lib/site", () => ({
  getSite: async () => ({ event: { id: "event-1", studioId: "studio-1", slug: "priya-arjun" } }),
  siteOrigin: () => "http://priya-arjun.localhost:3000",
}));

const limits = vi.hoisted(() => ({
  current: null as null | import("@hub/shared/ratePolicies").RateLimiter,
  audits: [] as Array<import("@hub/shared/ratePolicies").RateAuditEntry>,
}));
vi.mock("@hub/shared/ratePolicies", async (importActual) => {
  const actual = await importActual<typeof import("@hub/shared/ratePolicies")>();
  return {
    ...actual,
    rateLimits: {
      check: (...a: Parameters<typeof actual.rateLimits.check>) => limits.current!.check(...a),
      acquire: (...a: Parameters<typeof actual.rateLimits.acquire>) => limits.current!.acquire(...a),
    },
  };
});
const { rateLimiter } = await import("@hub/shared/ratePolicies");
const { memoryRateLimitStore } = await import("@hub/shared/ratelimit");

const { GET } = await import("./route.ts");

const hit = (token: string, ip: string | null = "203.0.113.9") =>
  GET(new NextRequest(`http://priya-arjun.localhost:3000/i/${token}`, { headers: ip ? { "x-forwarded-for": ip } : {} }), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  db.lookups = 0;
  limits.audits = [];
  limits.current = rateLimiter({ store: memoryRateLimitStore(), audit: async (e) => void limits.audits.push(e), env: {}, random: () => 1 });
});

describe("GET /i/[token] rate limit (SHR-003)", () => {
  it("60 hits per IP per hour reach the token lookup; the 61st gets 429 without one", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await hit(`guess-${i}`);
      expect(res.status, `hit ${i + 1}`).toBe(307);
      expect(res.headers.get("location")).toBe("http://priya-arjun.localhost:3000/?invite=expired");
    }
    expect(db.lookups).toBe(60);

    const limited = await hit("guess-60");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("set-cookie")).toBeNull();
    expect(db.lookups, "no token lookup once limited").toBe(60);
    expect(limits.audits).toMatchObject([{ action: "auth.rate_limited", eventId: "event-1", data: { policy: "inviteIp" } }]);
    expect(JSON.stringify(limits.audits)).not.toContain("203.0.113.9");
  });

  it("another client IP is not affected", async () => {
    for (let i = 0; i < 61; i++) await hit(`guess-${i}`);
    expect((await hit("guess-x", "198.51.100.7")).status).toBe(307);
  });

  it("without a proxy header (local dev) the per-IP limit does not apply", async () => {
    for (let i = 0; i < 61; i++) expect((await hit(`guess-${i}`, null)).status).toBe(307);
  });
});
