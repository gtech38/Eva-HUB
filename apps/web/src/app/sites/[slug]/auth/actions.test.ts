/**
 * SHR-003: guest sign-in rate limits. Prisma, the site context, the senders and the request headers
 * are faked at their seams; limits run on the real policy numbers over an in-memory store.
 *
 * The browser-level version of the first test (Mailpit as the oracle) waits for Playwright (#86).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  onList: new Set<string>(),
  loginTokens: 0,
  messages: 0,
}));

vi.mock("@hub/db", async (importActual) => {
  const actual = await importActual<typeof import("@hub/db")>();
  return {
    ...actual,
    prisma: {
      guest: {
        findMany: async ({ where }: { where: { email?: string; phone?: string } }) =>
          db.onList.has(where.email ?? where.phone ?? "") ? [{ id: "guest-1", userId: null }] : [],
      },
      contactPoint: { findUnique: async () => null },
      loginToken: {
        create: async () => {
          db.loginTokens++;
          return {};
        },
      },
      message: {
        create: async () => {
          db.messages++;
          return {};
        },
      },
    },
  };
});

const sent = vi.hoisted(() => ({ emails: [] as string[], sms: [] as string[] }));
vi.mock("@hub/shared", async (importActual) => {
  const actual = await importActual<typeof import("@hub/shared")>();
  return {
    ...actual,
    email: () => ({ send: async (m: { to: string }) => (sent.emails.push(m.to), { providerId: "fake" }) }),
    sms: () => ({ send: async (m: { to: string }) => (sent.sms.push(m.to), { providerId: "fake" }) }),
  };
});

vi.mock("@/lib/site", () => ({
  getSite: async () => ({
    event: { id: "event-1", studioId: "studio-1", slug: "priya-arjun", title: { en: "Priya & Arjun" } },
    locale: "en",
  }),
}));

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

const { requestSignIn } = await import("./actions.ts");

const form = (contact: string) => {
  const fd = new FormData();
  fd.set("contact", contact);
  return fd;
};
const signIn = (contact: string) => requestSignIn(null, form(contact));

beforeEach(() => {
  db.onList = new Set(["priya@localhost", "+15551234567"]);
  db.loginTokens = 0;
  db.messages = 0;
  sent.emails = [];
  sent.sms = [];
  req.headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
  limits.audits = [];
  limits.current = rateLimiter({ store: memoryRateLimitStore(), audit: async (e) => void limits.audits.push(e), env: {}, random: () => 1 });
});

describe("requestSignIn rate limits (SHR-003)", () => {
  it("6 sign-in requests for one address yield 5 messages and identical responses", async () => {
    const responses: unknown[] = [];
    for (let i = 0; i < 6; i++) responses.push(await signIn("Priya@Localhost"));
    expect(sent.emails).toStrictEqual(Array(5).fill("priya@localhost"));
    expect(db.loginTokens, "no token minted for the limited request").toBe(5);
    expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(responses[0]).toStrictEqual({ message: "If you're on the guest list, we've sent you a link." });
  });

  it("limited, on-list and off-list requests all get the same answer", async () => {
    const onList: unknown[] = [];
    for (let i = 0; i < 6; i++) onList.push(await signIn("priya@localhost"));
    const offList: unknown[] = [];
    for (let i = 0; i < 6; i++) offList.push(await signIn("stranger@example.com"));
    expect([...onList, ...offList].every((r) => JSON.stringify(r) === JSON.stringify(onList[0]))).toBe(true);
    expect(sent.emails).toHaveLength(5);
  });

  it("off-list addresses are counted exactly like on-list ones, so a trip reveals nothing about the list", async () => {
    for (let i = 0; i < 6; i++) await signIn("stranger@example.com");
    for (let i = 0; i < 6; i++) await signIn("priya@localhost");
    expect(limits.audits.map((a) => a.data.policy)).toStrictEqual(["signInAddress", "signInAddress"]);
  });

  it("limits SMS sign-in per phone number the same way", async () => {
    for (let i = 0; i < 6; i++) await signIn("(555) 123-4567");
    expect(sent.sms).toStrictEqual(Array(5).fill("+15551234567"));
  });

  it("30 requests per IP per 15 minutes across different addresses, then nothing is sent", async () => {
    for (let i = 0; i < 31; i++) db.onList.add(`guest${i}@localhost`);
    for (let i = 0; i < 31; i++) await signIn(`guest${i}@localhost`);
    expect(sent.emails).toHaveLength(30);
    expect(sent.emails).not.toContain("guest30@localhost");
    req.headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    await signIn("guest30@localhost");
    expect(sent.emails, "another client is unaffected").toContain("guest30@localhost");
  });

  it("audits the trip once, scoped to the event, with the hashed key only", async () => {
    for (let i = 0; i < 8; i++) await signIn("priya@localhost");
    expect(limits.audits).toHaveLength(1);
    expect(limits.audits[0]).toMatchObject({ action: "auth.rate_limited", studioId: "studio-1", eventId: "event-1", data: { policy: "signInAddress" } });
    expect(JSON.stringify(limits.audits)).not.toContain("priya");
  });
});
