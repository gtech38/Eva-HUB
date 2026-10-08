/**
 * Postgres-backed tests for the RSVP report loaders in guests.ts. They seed their own studio, events
 * and guests (test/reportFixture.ts), so they need only the local stack (pnpm infra:up) and a
 * migrated database. Without Postgres they are skipped with a message locally, and FAIL when CI is
 * set: a green CI run must mean the vendor-privacy checks actually ran.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { loadRsvpReport, loadWideCsv } from "./guests";
import { PHONE, principal, seedReportFixture, type ReportFixture } from "../../test/reportFixture";

const run = `zq${Date.now().toString(36)}`;
const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);
const skipReason = "Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up";

if (!dbUp && inCi) {
  describe("RSVP report loaders against Postgres", () => {
    it("requires Postgres when CI is set", () => { throw new Error(skipReason); });
  });
} else if (!dbUp) console.log(`# apps/admin guests.db: ${skipReason} -- skipping`);

describe.skipIf(!dbUp)(dbUp ? "RSVP report loaders against Postgres" : `RSVP report loaders [skipped: ${skipReason}]`, () => {
  let fx: ReportFixture;
  let cleanup: () => Promise<void> = async () => {};
  beforeAll(async () => { ({ fx, cleanup } = await seedReportFixture(run)); });
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  const res = () => ({ studioId: fx.studioId, eventId: fx.eventId });
  const HOST = () => principal({ userId: "host", eventRoles: { [fx.eventId]: ["HOST"] } });
  const VENDOR = () => principal({ userId: "vendor", eventRoles: { [fx.eventId]: ["VENDOR"] } });
  const dinner = (rep: NonNullable<Awaited<ReturnType<typeof loadRsvpReport>>>) => rep.subEvents.find((s) => s.id === fx.dinnerId)!;

  it("vendor gets meal counts only: no names, emails, phones, response counts or household figures anywhere in the payload", async () => {
    const report = (await loadRsvpReport(VENDOR(), res()))!;
    expect(report.access).toBe("totals");
    const d = dinner(report);
    expect(d.guests).toBeUndefined();
    expect(d.responses).toBeUndefined();
    expect(report.households).toBeUndefined();
    expect(Object.keys(d.summary).sort()).toEqual(["adults", "attending", "kids", "meals"]);
    expect(d.summary).toMatchObject({ attending: 2, adults: 1, kids: 1 });
    const json = JSON.stringify(report);
    expect(json).not.toContain(run);
    expect(json).not.toContain(PHONE.slice(1));
    expect(json).not.toContain("example.com");
  });

  it("meal totals count attending guests only, per option, excluding declined and soft-deleted guests", async () => {
    const d = dinner((await loadRsvpReport(VENDOR(), res()))!);
    expect(d.summary.meals.byOption.map((o) => [o.optionId, o.adults, o.kids, o.total])).toEqual([
      [fx.meals.veg, 1, 0, 1],
      [fx.meals.nonveg, 0, 0, 0], // the declined guest's stale choice is not a plate
      [fx.meals.kids, 0, 1, 1],
    ]);
    expect(d.summary.meals.noChoice.total).toBe(0);
  });

  it("host gets names, response counts, household figures, and no meal for a declined guest", async () => {
    const report = (await loadRsvpReport(HOST(), res()))!;
    expect(report.access).toBe("names");
    expect(report.households).toEqual({ total: 1, withPending: 1 });
    const d = dinner(report);
    expect(d.responses).toEqual({ invited: 4, declined: 1, pending: 1 });
    expect(d.guests!.map((g) => [g.guest, g.isChild, g.status, g.meal])).toEqual([
      [`Adult ${run}`, false, "ATTENDING", "Vegetarian"],
      [`Child ${run}`, true, "ATTENDING", "Kids plate"],
      [`Declined ${run}`, false, "DECLINED", ""],
      [`Pending ${run}`, false, "PENDING", ""],
    ]);
    expect(d.guests!.every((g) => g.household === fx.householdName && typeof g.id === "string")).toBe(true);
    expect(new Set(d.guests!.map((g) => g.id)).size).toBe(4); // unique, usable as React keys
  });

  it("totalsOnly narrows a names user to totals but can never widen a vendor", async () => {
    const narrowed = (await loadRsvpReport(HOST(), res(), { totalsOnly: true }))!;
    expect(narrowed.access).toBe("totals");
    expect(dinner(narrowed).guests).toBeUndefined();
    expect((await loadRsvpReport(VENDOR(), res(), { totalsOnly: false }))!.access).toBe("totals");
  });

  it("is null for guests, signed-out, invite-link sessions and roles on another event", async () => {
    expect(await loadRsvpReport(null, res())).toBeNull();
    expect(await loadRsvpReport(principal({ guestOf: new Set([fx.eventId]) }), res())).toBeNull();
    expect(await loadRsvpReport(principal({ authMethod: "INVITE_LINK", eventRoles: { [fx.eventId]: ["HOST"] } }), res())).toBeNull();
    expect(await loadRsvpReport(principal({ eventRoles: { [fx.otherEventId]: ["HOST"] } }), res())).toBeNull();
  });

  it("is scoped by studio as well as event: a wrong studioId yields nothing even for a real host", async () => {
    const report = (await loadRsvpReport(HOST(), { studioId: "some-other-studio", eventId: fx.eventId }))!;
    expect(report.subEvents).toEqual([]);
    expect(report.households).toEqual({ total: 0, withPending: 0 });
  });

  it("reports sub-events in order, or one sub-event by id; an id from another event yields nothing", async () => {
    const all = (await loadRsvpReport(VENDOR(), res()))!;
    expect(all.subEvents.map((s) => s.id)).toEqual([fx.haldiId, fx.dinnerId]);
    expect((await loadRsvpReport(VENDOR(), res(), { subEventId: fx.dinnerId }))!.subEvents.map((s) => s.id)).toEqual([fx.dinnerId]);
    expect((await loadRsvpReport(HOST(), res(), { subEventId: fx.otherSubId }))!.subEvents).toEqual([]);
  });

  it("Rsvp has the (subEventId, status) index the report counts use (docs/03 §3)", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE tablename = 'Rsvp' AND indexname = 'Rsvp_subEventId_status_idx'`;
    expect(rows.map((r) => r.indexdef)).toEqual([expect.stringContaining('("subEventId", status)')]);
  });

  it("loadWideCsv is name-level (null for vendors), one row per live guest, and uses the same meal rule", async () => {
    expect(await loadWideCsv(VENDOR(), res())).toBeNull();
    const table = (await loadWideCsv(HOST(), res()))!;
    expect(table[0].slice(0, 8)).toEqual(["household", "first_name", "last_name", "email", "phone", "is_child", "is_plus_one", "linked_user"]);
    expect(table.slice(1).map((r) => r[1])).toEqual(["Adult", "Child", "Declined", "Pending"]);
    const mealCol = table[0].indexOf("Dinner meal");
    expect(table.slice(1).map((r) => r[mealCol])).toEqual(["Vegetarian", "Kids plate", "", ""]); // declined guest: blank, as in the guest list
  });
});
