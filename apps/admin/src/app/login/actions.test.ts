/**
 * SHR-003: admin magic-link requests are limited per address (5 per 15 min). Over the limit the
 * reply is the usual neutral sentence and nothing is sent or written, for members and strangers
 * alike. Prisma and the email sender are faked; limits use the real policy over an in-memory store.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ loginTokens: [] as Array<string | null> }));
vi.mock("@hub/db", async (importActual) => {
  const actual = await importActual<typeof import("@hub/db")>();
  return {
    ...actual,
    prisma: {
      contactPoint: {
        findUnique: async ({ where }: { where: { kind_value: { value: string } } }) =>
          where.kind_value.value === "admin@localhost"
            ? { user: { id: "user-admin", deletedAt: null, status: "ACTIVE", isPlatformAdmin: true, studioMembers: [] } }
            : null,
      },
      loginToken: {
        create: async ({ data }: { data: { userId: string | null } }) => {
          db.loginTokens.push(data.userId);
          return {};
        },
      },
    },
  };
});

const sent = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@hub/shared", async (importActual) => {
  const actual = await importActual<typeof import("@hub/shared")>();
  return { ...actual, email: () => ({ send: async (m: { to: string }) => (sent.emails.push(m.to), { providerId: "fake" }) }) };
});

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => req.headers }));

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

const { requestMagicLink } = await import("./actions.ts");

const request = (address: string) => {
  const fd = new FormData();
  fd.set("email", address);
  return requestMagicLink(null, fd);
};

beforeEach(() => {
  db.loginTokens = [];
  sent.emails = [];
  req.headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
  limits.audits = [];
  limits.current = rateLimiter({ store: memoryRateLimitStore(), audit: async (e) => void limits.audits.push(e), env: {}, random: () => 1 });
});

describe("requestMagicLink rate limit (SHR-003)", () => {
  it("6 requests for one admin address send 5 links and get 6 identical replies", async () => {
    const replies: unknown[] = [];
    for (let i = 0; i < 6; i++) replies.push(await request("Admin@Localhost"));
    expect(sent.emails).toStrictEqual(Array(5).fill("admin@localhost"));
    expect(db.loginTokens).toStrictEqual(Array(5).fill("user-admin"));
    expect(new Set(replies.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("a stranger gets the same reply, limited or not, and the limit skips the dummy token too", async () => {
    const member: unknown[] = [];
    for (let i = 0; i < 6; i++) member.push(await request("admin@localhost"));
    const stranger: unknown[] = [];
    for (let i = 0; i < 6; i++) stranger.push(await request("nobody@example.com"));
    expect([...member, ...stranger].every((r) => JSON.stringify(r) === JSON.stringify(member[0]))).toBe(true);
    expect(db.loginTokens.filter((u) => u === null), "five dummy tokens, none once limited").toHaveLength(5);
  });

  it("audits the trip once, with the hashed address only", async () => {
    for (let i = 0; i < 7; i++) await request("admin@localhost");
    expect(limits.audits).toMatchObject([{ action: "auth.rate_limited", studioId: null, eventId: null, data: { policy: "adminMagicLinkAddressIp" } }]);
    expect(JSON.stringify(limits.audits)).not.toContain("admin@");
  });

  it("a stranger on another network cannot burn the admin's attempts; IP rotation is capped at 20", async () => {
    req.headers = new Headers({ "x-forwarded-for": "6.6.6.6" });
    for (let i = 0; i < 10; i++) await request("admin@localhost");
    expect(sent.emails).toHaveLength(5);
    req.headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    await request("admin@localhost");
    expect(sent.emails, "the admin's own network still gets a link").toHaveLength(6);
    for (let i = 0; i < 30; i++) {
      req.headers = new Headers({ "x-forwarded-for": `198.51.100.${i}` });
      await request("admin@localhost");
    }
    expect(sent.emails, "address-only cap").toHaveLength(20);
  });

  it("60 requests per IP per 15 minutes across addresses, then nothing more is written", async () => {
    for (let i = 0; i < 61; i++) await request(`stranger${i}@example.com`);
    expect(db.loginTokens).toHaveLength(60);
  });

  it("a limiter failure sends nothing and gives the same reply, without leaking the error", async () => {
    const ok = await request("admin@localhost");
    sent.emails = [];
    limits.current = { check: async () => Promise.reject(new Error("prisma: connection refused")), acquire: async () => Promise.reject(new Error("x")) };
    const r = await request("admin@localhost");
    expect(r).toStrictEqual(ok);
    expect(JSON.stringify(r)).not.toContain("prisma");
    expect(sent.emails).toStrictEqual([]);
  });
});
