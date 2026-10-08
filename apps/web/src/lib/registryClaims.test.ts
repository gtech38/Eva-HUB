/**
 * Postgres-backed tests for claiming / undoing registry items. The suite seeds its own studio and
 * two events (no dependence on `db:seed`), records every id as it is created and removes exactly
 * those rows in afterAll, so it also runs on CI's empty migrated database. Without Postgres the
 * tests are skipped with a message locally and FAIL when CI is set: a green CI run must mean the
 * oversell, ownership and tenant-isolation checks actually ran.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@hub/db";
import { claimRegistryItem, undoRegistryClaim } from "./registryClaims.ts";
import { CLAIM_DEDUPE_WINDOW_MS, UNDO_WINDOW_MS } from "./registry.ts";

const run = `zr${Date.now().toString(36)}`;

const dbUp = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const skipReason = `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`;

if (!dbUp && inCi) {
  describe("registry claims against Postgres", () => {
    it("requires Postgres when CI is set", () => {
      throw new Error(skipReason);
    });
  });
} else if (!dbUp) console.log(`# apps/web registryClaims: ${skipReason} -- skipping`);

const suite = dbUp ? "registry claims against Postgres" : `registry claims against Postgres [skipped: ${skipReason}]`;

const made = { studio: [] as string[], event: [] as string[] };
let studioId = "";
let eventId = "";
let otherEventId = "";

const newItem = (quantity: number, forEvent = eventId) =>
  prisma.registryItem.create({ data: { eventId: forEvent, title: { en: run }, url: "https://example.com/x", quantity } });
const claimsOf = (itemId: string) => prisma.registryClaim.findMany({ where: { itemId } });
const auditsFor = (itemId: string) => prisma.auditLog.findMany({ where: { target: itemId }, orderBy: { id: "asc" } });
const claim = (itemId: string, userId: string, quantity = 1, over: Partial<Parameters<typeof claimRegistryItem>[0]> = {}) =>
  claimRegistryItem({ eventId, studioId, itemId, userId, guestName: userId, quantity, ...over });

beforeAll(async () => {
  if (!dbUp) return;
  const studio = await prisma.studio.create({ data: { slug: `t-${run}`, name: `${run} Studio` } });
  made.studio.push(studio.id);
  studioId = studio.id;
  const mk = async (suffix: string) => {
    const e = await prisma.event.create({ data: { studioId, slug: `${run}-${suffix}`, title: { en: `${run} ${suffix}` }, theme: "LUXURY" } });
    made.event.push(e.id);
    return e.id;
  };
  eventId = await mk("a");
  otherEventId = await mk("b");
});

afterAll(async () => {
  if (dbUp) {
    const items = await prisma.registryItem.findMany({ where: { eventId: { in: made.event } }, select: { id: true } });
    const ids = items.map((i) => i.id);
    await prisma.registryClaim.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.registryItem.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ studioId: { in: made.studio } }, { target: { in: ids } }] } });
    await prisma.event.deleteMany({ where: { id: { in: made.event } } });
    await prisma.studio.deleteMany({ where: { id: { in: made.studio } } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  it("claiming an item decrements availability and a claim beyond quantity is refused", async () => {
    const item = await newItem(2);
    expect(await claim(item.id, "u-a", 1)).toMatchObject({ ok: true, remaining: 1 });
    expect(await claim(item.id, "u-b", 2)).toEqual({ ok: false, reason: "exceeds_remaining", remaining: 1 });
    expect(await claim(item.id, "u-b", 1)).toMatchObject({ ok: true, remaining: 0 });
    expect(await claim(item.id, "u-c", 1)).toEqual({ ok: false, reason: "sold_out" });
    expect(await claimsOf(item.id)).toHaveLength(2);
  });

  it("a claim is tied to the claimer's userId and display name", async () => {
    const item = await newItem(1);
    expect((await claim(item.id, "u-a", 1, { guestName: "Asha Rao" })).ok).toBe(true);
    const [row] = await claimsOf(item.id);
    expect(row).toMatchObject({ userId: "u-a", guestName: "Asha Rao", quantity: 1 });
  });

  it("audits a successful claim and undo (registry.claim / registry.unclaim) and nothing for refusals", async () => {
    const item = await newItem(1);
    await claim(item.id, "u-a");
    await claim(item.id, "u-b"); // sold out
    expect((await auditsFor(item.id)).map((a) => a.action)).toEqual(["registry.claim"]);
    const [row] = await claimsOf(item.id);
    await undoRegistryClaim({ eventId, studioId, claimId: row!.id, userId: "u-b" }); // not the owner
    expect(await auditsFor(item.id)).toHaveLength(1);
    await undoRegistryClaim({ eventId, studioId, claimId: row!.id, userId: "u-a" });
    const audits = await auditsFor(item.id);
    expect(audits.map((a) => a.action)).toEqual(["registry.claim", "registry.unclaim"]);
    expect(audits[0]).toMatchObject({ studioId, eventId, actorUserId: "u-a", target: item.id });
  });

  it("concurrent claims for the last units never oversell", async () => {
    const item = await newItem(2);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => claim(item.id, `u-${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect((await claimsOf(item.id)).reduce((n, c) => n + c.quantity, 0)).toBe(2);
  });

  it("an item from another event is not found (tenant scope)", async () => {
    const item = await newItem(1, otherEventId);
    expect(await claim(item.id, "u-a")).toEqual({ ok: false, reason: "not_found" });
    expect(await claimsOf(item.id)).toHaveLength(0);
  });

  it("another guest cannot undo a claim; the owner can", async () => {
    const item = await newItem(1);
    await claim(item.id, "u-a");
    const [row] = await claimsOf(item.id);
    expect(await undoRegistryClaim({ eventId, studioId, claimId: row!.id, userId: "u-b" })).toEqual({ ok: false });
    expect(await claimsOf(item.id)).toHaveLength(1);
    expect(await undoRegistryClaim({ eventId, studioId, claimId: row!.id, userId: "u-a" })).toEqual({ ok: true });
    expect(await claimsOf(item.id)).toHaveLength(0);
  });

  it("undo is refused after 24 hours and across events", async () => {
    const item = await newItem(1);
    await claim(item.id, "u-a");
    const [row] = await claimsOf(item.id);
    const late = new Date(row!.claimedAt.getTime() + UNDO_WINDOW_MS + 1000);
    expect(await undoRegistryClaim({ eventId, studioId, claimId: row!.id, userId: "u-a", now: late })).toEqual({ ok: false });
    expect(await undoRegistryClaim({ eventId: otherEventId, studioId, claimId: row!.id, userId: "u-a" })).toEqual({ ok: false });
    expect(await claimsOf(item.id)).toHaveLength(1);
  });

  describe("double submit", () => {
    it("a second claim by the same user on the same item within 10 s returns the first claim, not a second one", async () => {
      const item = await newItem(3);
      const first = await claim(item.id, "u-a");
      const again = await claim(item.id, "u-a");
      expect(first.ok && again.ok).toBe(true);
      if (first.ok && again.ok) expect(again.claimId).toBe(first.claimId);
      expect(await claimsOf(item.id)).toHaveLength(1);
      expect((await auditsFor(item.id)).map((a) => a.action)).toEqual(["registry.claim"]);
    });

    it("is idempotent even when the first claim took the last unit (no 'sold out' for your own double click)", async () => {
      const item = await newItem(1);
      const first = await claim(item.id, "u-a");
      const again = await claim(item.id, "u-a");
      expect(again).toMatchObject({ ok: true });
      if (first.ok && again.ok) expect(again.claimId).toBe(first.claimId);
    });

    it("two simultaneous identical submits create exactly one claim", async () => {
      const item = await newItem(3);
      const [a, b] = await Promise.all([claim(item.id, "u-a"), claim(item.id, "u-a")]);
      expect(a.ok && b.ok).toBe(true);
      expect(await claimsOf(item.id)).toHaveLength(1);
    });

    it("does not merge claims by different users or on different items", async () => {
      const one = await newItem(3);
      const two = await newItem(3);
      await claim(one.id, "u-a");
      await claim(one.id, "u-b");
      await claim(two.id, "u-a");
      expect(await claimsOf(one.id)).toHaveLength(2);
      expect(await claimsOf(two.id)).toHaveLength(1);
    });

    it("a different quantity within the window is a real second claim, never a silent 'ok' that records the first quantity", async () => {
      const item = await newItem(5);
      const first = await claim(item.id, "u-a", 1);
      const second = await claim(item.id, "u-a", 2);
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) expect(second.claimId).not.toBe(first.claimId);
      expect((await claimsOf(item.id)).map((c) => c.quantity).sort()).toEqual([1, 2]);
      // ...and it is still subject to the remaining count.
      expect(await claim(item.id, "u-a", 3)).toEqual({ ok: false, reason: "exceeds_remaining", remaining: 2 });
    });

    it("an invalid quantity is refused even when it would otherwise look like a double submit", async () => {
      const item = await newItem(3);
      await claim(item.id, "u-a", 1);
      for (const q of [0, -1, 1.5, Number.NaN]) {
        expect(await claim(item.id, "u-a", q), String(q)).toEqual({ ok: false, reason: "invalid_quantity" });
      }
      expect(await claimsOf(item.id)).toHaveLength(1);
    });

    it("a later claim (after the 10 s window) by the same user is a new claim", async () => {
      const item = await newItem(3);
      const first = await claim(item.id, "u-a");
      const later = new Date(Date.now() + CLAIM_DEDUPE_WINDOW_MS + 1000);
      const second = await claim(item.id, "u-a", 1, { now: later });
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) expect(second.claimId).not.toBe(first.claimId);
      expect(await claimsOf(item.id)).toHaveLength(2);
    });
  });

  describe("database failures", () => {
    it("a transaction error (lock timeout, P2028) becomes a refusal, not an unhandled exception", async () => {
      const item = await newItem(1);
      const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("Transaction API error: Unable to start a transaction in the given time."));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await claim(item.id, "u-a")).toEqual({ ok: false, reason: "failed" });
      } finally {
        spy.mockRestore();
        quiet.mockRestore();
      }
      expect(await claimsOf(item.id)).toHaveLength(0);
    });

    it("an undo that hits a database error reports not-ok instead of throwing", async () => {
      const item = await newItem(1);
      await claim(item.id, "u-a");
      const [row] = await claimsOf(item.id);
      const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("lock timeout"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await undoRegistryClaim({ eventId, studioId, claimId: row!.id, userId: "u-a" })).toEqual({ ok: false });
      } finally {
        spy.mockRestore();
        quiet.mockRestore();
      }
      expect(await claimsOf(item.id)).toHaveLength(1);
    });
  });
});
