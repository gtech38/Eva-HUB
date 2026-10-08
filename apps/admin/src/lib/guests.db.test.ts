/**
 * Postgres-backed tests for the RSVP report loaders in guests.ts. They need the local stack and a
 * seeded database (pnpm infra:up && pnpm db:seed); when Postgres or the seeded `priya-arjun` event
 * is missing every test is skipped with a message instead of failing.
 *
 * Fixture rows (one household, an adult and a child) carry a per-run marker in their names and
 * email so assertions can prove the marker never appears in a totals-only report; afterAll()
 * deletes them by id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { loadRsvpReport, loadWideCsv } from "./guests";

const run = `zq${Date.now().toString(36)}`;

const event = await prisma.event.findFirst({ where: { slug: "priya-arjun" }, select: { id: true, studioId: true } }).catch(() => null);
const sub = event
  ? await prisma.subEvent.findFirst({ where: { eventId: event.id, servesMeal: true, mealOptions: { some: {} } }, include: { mealOptions: { orderBy: { sortOrder: "asc" } } } })
  : null;
const other = event ? await prisma.subEvent.findFirst({ where: { eventId: { not: event.id } }, select: { id: true } }) : null;
const ready = Boolean(event && sub && other);
const skipReason = "Postgres unreachable or not seeded (pnpm infra:up && pnpm db:seed)";
if (!ready) console.log(`# apps/admin guests.db: ${skipReason} -- skipping`);

describe.skipIf(!ready)(ready ? "RSVP report loaders against Postgres" : `RSVP report loaders [skipped: ${skipReason}]`, () => {
  const ids = { household: "", adult: "", child: "", gone: "" };

  beforeAll(async () => {
    const { id: eventId, studioId } = event!;
    const meal = sub!.mealOptions[0];
    const hh = await prisma.household.create({ data: { eventId, studioId, name: `${run} Household` } });
    const mk = (firstName: string, isChild: boolean, deletedAt: Date | null = null) =>
      prisma.guest.create({ data: { eventId, studioId, householdId: hh.id, firstName, lastName: run, email: isChild ? null : `${run}@example.com`, phone: isChild ? null : "+15125550199", isChild, deletedAt } });
    const [adult, child, gone] = [await mk("Adult", false), await mk("Child", true), await mk("Removed", false, new Date())];
    for (const g of [adult, child, gone]) {
      await prisma.subEventInvite.create({ data: { guestId: g.id, subEventId: sub!.id } });
      await prisma.rsvp.create({ data: { guestId: g.id, subEventId: sub!.id, status: "ATTENDING", mealOptionId: meal.id } });
    }
    Object.assign(ids, { household: hh.id, adult: adult.id, child: child.id, gone: gone.id });
  });

  afterAll(async () => {
    const guestIds = [ids.adult, ids.child, ids.gone].filter(Boolean);
    await prisma.rsvp.deleteMany({ where: { guestId: { in: guestIds } } });
    await prisma.subEventInvite.deleteMany({ where: { guestId: { in: guestIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: guestIds } } });
    if (ids.household) await prisma.household.delete({ where: { id: ids.household } });
    await prisma.$disconnect();
  });

  it("totals mode returns counts with no guest names, emails or phones anywhere in the payload", async () => {
    const report = await loadRsvpReport(event!.id, "totals", { subEventId: sub!.id });
    expect(report.access).toBe("totals");
    expect(report.subEvents.map((s) => s.id)).toEqual([sub!.id]);
    const s = report.subEvents[0];
    expect(s.guests).toBeUndefined();
    expect(s.summary.attending).toBeGreaterThanOrEqual(2);
    expect(s.summary.kids).toBeGreaterThanOrEqual(1);
    expect(s.summary.meals.byOption[0].total).toBeGreaterThanOrEqual(2);
    const json = JSON.stringify(report);
    expect(json).not.toContain(run);
    expect(json).not.toContain("5125550199");
  });

  it("names mode lists household, guest, child flag, status and meal; soft-deleted guests are left out", async () => {
    const report = await loadRsvpReport(event!.id, "names", { subEventId: sub!.id });
    const mine = report.subEvents[0].guests!.filter((g) => g.household === `${run} Household`);
    expect(mine).toEqual([
      { household: `${run} Household`, guest: `Adult ${run}`, isChild: false, status: "ATTENDING", meal: expect.any(String) },
      { household: `${run} Household`, guest: `Child ${run}`, isChild: true, status: "ATTENDING", meal: expect.any(String) },
    ]);
    expect(mine[0].meal).not.toBe("");
  });

  it("without subEventId it reports every sub-event of the event, in order", async () => {
    const report = await loadRsvpReport(event!.id, "totals");
    const subs = await prisma.subEvent.findMany({ where: { eventId: event!.id }, orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }], select: { id: true } });
    expect(report.subEvents.map((s) => s.id)).toEqual(subs.map((s) => s.id));
  });

  it("a sub-event id from another event yields nothing (tenant scope)", async () => {
    expect((await loadRsvpReport(event!.id, "names", { subEventId: other!.id })).subEvents).toEqual([]);
  });

  it("loadWideCsv has one row per live guest with the existing wide columns", async () => {
    const table = await loadWideCsv(event!.id);
    expect(table[0].slice(0, 8)).toEqual(["household", "first_name", "last_name", "email", "phone", "is_child", "is_plus_one", "linked_user"]);
    const mine = table.filter((r) => r[0] === `${run} Household`);
    expect(mine.map((r) => r[1])).toEqual(["Adult", "Child"]);
  });
});
