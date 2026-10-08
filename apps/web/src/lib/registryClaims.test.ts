/**
 * Postgres-backed tests for claiming / undoing registry items. Uses the first seeded event as the
 * tenant and a second one to prove isolation; every item is titled with the per-run marker and
 * deleted (with its claims) in afterAll. Skipped with a reason when Postgres is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { claimRegistryItem, undoRegistryClaim } from "./registryClaims.ts";
import { UNDO_WINDOW_MS } from "./registry.ts";

const run = `test-registry-${Date.now()}`;

const dbUp = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
const dbHost = (process.env.DATABASE_URL ?? "unset").replace(/\/\/[^@/]*@/, "//<creds>@");
const skipReason = `Postgres unreachable at DATABASE_URL (${dbHost}); start it with: pnpm infra:up`;
if (!dbUp) console.log(`# apps/web: ${skipReason} -- skipping`);
const suite = dbUp ? "registry claims against Postgres" : `registry claims against Postgres [skipped: ${skipReason}]`;

let eventId = "";
let otherEventId = "";

const newItem = (quantity: number, forEvent = eventId) =>
  prisma.registryItem.create({ data: { eventId: forEvent, title: { en: run }, url: "https://example.com/x", quantity } });
const claimsOf = (itemId: string) => prisma.registryClaim.findMany({ where: { itemId } });

beforeAll(async () => {
  if (!dbUp) return;
  const events = await prisma.event.findMany({ take: 2, orderBy: { createdAt: "asc" }, select: { id: true } });
  eventId = events[0]!.id;
  otherEventId = events[1]!.id;
});

afterAll(async () => {
  if (dbUp) {
    const items = await prisma.registryItem.findMany({ where: { title: { path: ["en"], equals: run } }, select: { id: true } });
    await prisma.registryClaim.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
    await prisma.registryItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  it("claiming an item decrements availability and a claim beyond quantity is refused", async () => {
    const item = await newItem(2);
    const first = await claimRegistryItem({ eventId, itemId: item.id, userId: "u-a", guestName: "Asha", quantity: 1 });
    expect(first).toMatchObject({ ok: true, remaining: 1 });
    const tooMany = await claimRegistryItem({ eventId, itemId: item.id, userId: "u-b", guestName: "Bo", quantity: 2 });
    expect(tooMany).toEqual({ ok: false, reason: "exceeds_remaining", remaining: 1 });
    const last = await claimRegistryItem({ eventId, itemId: item.id, userId: "u-b", guestName: "Bo", quantity: 1 });
    expect(last).toMatchObject({ ok: true, remaining: 0 });
    const soldOut = await claimRegistryItem({ eventId, itemId: item.id, userId: "u-c", guestName: "Cy", quantity: 1 });
    expect(soldOut).toEqual({ ok: false, reason: "sold_out" });
    expect(await claimsOf(item.id)).toHaveLength(2);
  });

  it("a claim is tied to the claimer's userId and display name", async () => {
    const item = await newItem(1);
    const res = await claimRegistryItem({ eventId, itemId: item.id, userId: "u-a", guestName: "Asha Rao", quantity: 1 });
    expect(res.ok).toBe(true);
    const [row] = await claimsOf(item.id);
    expect(row).toMatchObject({ userId: "u-a", guestName: "Asha Rao", quantity: 1 });
  });

  it("concurrent claims for the last units never oversell", async () => {
    const item = await newItem(2);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => claimRegistryItem({ eventId, itemId: item.id, userId: `u-${i}`, guestName: `G${i}`, quantity: 1 })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const total = (await claimsOf(item.id)).reduce((n, c) => n + c.quantity, 0);
    expect(total).toBe(2);
  });

  it("an item from another event is not found (tenant scope)", async () => {
    const item = await newItem(1, otherEventId);
    const res = await claimRegistryItem({ eventId, itemId: item.id, userId: "u-a", guestName: "Asha", quantity: 1 });
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(await claimsOf(item.id)).toHaveLength(0);
  });

  it("another guest cannot undo a claim; the owner can", async () => {
    const item = await newItem(1);
    await claimRegistryItem({ eventId, itemId: item.id, userId: "u-a", guestName: "Asha", quantity: 1 });
    const [claim] = await claimsOf(item.id);
    expect(await undoRegistryClaim({ eventId, claimId: claim!.id, userId: "u-b" })).toEqual({ ok: false });
    expect(await claimsOf(item.id)).toHaveLength(1);
    expect(await undoRegistryClaim({ eventId, claimId: claim!.id, userId: "u-a" })).toEqual({ ok: true });
    expect(await claimsOf(item.id)).toHaveLength(0);
  });

  it("undo is refused after 24 hours and across events", async () => {
    const item = await newItem(1);
    await claimRegistryItem({ eventId, itemId: item.id, userId: "u-a", guestName: "Asha", quantity: 1 });
    const [claim] = await claimsOf(item.id);
    const late = new Date(claim!.claimedAt.getTime() + UNDO_WINDOW_MS + 1000);
    expect(await undoRegistryClaim({ eventId, claimId: claim!.id, userId: "u-a", now: late })).toEqual({ ok: false });
    expect(await undoRegistryClaim({ eventId: otherEventId, claimId: claim!.id, userId: "u-a" })).toEqual({ ok: false });
    expect(await claimsOf(item.id)).toHaveLength(1);
  });
});
