import { describe, expect, it } from "vitest";
import type { Principal } from "@hub/shared";
import { mealTotals, reportAccess, summarizeSubEvent, type ReportMealOption, type ReportRsvp } from "./guests";

const VEG: ReportMealOption = { id: "veg", label: { en: "Vegetarian", te: "శాకాహారం" }, isKidsMeal: false };
const NONVEG: ReportMealOption = { id: "nonveg", label: { en: "Non-vegetarian" }, isKidsMeal: false };
const KIDS: ReportMealOption = { id: "kids", label: { en: "Kids plate" }, isKidsMeal: true };
const OPTIONS = [VEG, NONVEG, KIDS];

const rsvp = (status: ReportRsvp["status"], mealOptionId: string | null, isChild = false): ReportRsvp => ({ status, mealOptionId, isChild });

const RSVPS: ReportRsvp[] = [
  rsvp("ATTENDING", "veg"),
  rsvp("ATTENDING", "veg"),
  rsvp("ATTENDING", "veg", true), // a child eating the adult veg plate
  rsvp("ATTENDING", "kids", true),
  rsvp("ATTENDING", "kids", true),
  rsvp("ATTENDING", "nonveg"),
  rsvp("ATTENDING", null), // attending, no meal chosen yet
  rsvp("ATTENDING", null, true),
  rsvp("DECLINED", "veg"), // declined guests never count
  rsvp("PENDING", "nonveg"),
  rsvp("PENDING", null, true),
];

describe("mealTotals()", () => {
  it("groups attending adults and kids per meal option, in option order", () => {
    const m = mealTotals(RSVPS, OPTIONS);
    expect(m.byOption.map((o) => [o.optionId, o.adults, o.kids, o.total])).toEqual([
      ["veg", 2, 1, 3],
      ["nonveg", 1, 0, 1],
      ["kids", 0, 2, 2],
    ]);
    expect(m.byOption.map((o) => o.isKidsMeal)).toEqual([false, false, true]);
    expect(m.byOption[0].label).toEqual(VEG.label);
  });

  it("counts attending guests without a choice separately", () => {
    expect(mealTotals(RSVPS, OPTIONS).noChoice).toEqual({ adults: 1, kids: 1, total: 2 });
  });

  it("splits plates into adult meals and kids meals by MealOption.isKidsMeal", () => {
    const m = mealTotals(RSVPS, OPTIONS);
    expect(m.adultMeals).toBe(4); // 3 veg + 1 non-veg, whoever eats them
    expect(m.kidsMeals).toBe(2);
  });

  it("lists options nobody picked with zero counts", () => {
    const m = mealTotals([rsvp("ATTENDING", "veg")], OPTIONS);
    expect(m.byOption.map((o) => o.total)).toEqual([1, 0, 0]);
  });

  it("treats a meal id that is not one of the sub-event's options as no choice, so totals still add up", () => {
    const m = mealTotals([rsvp("ATTENDING", "other-subevent-meal")], OPTIONS);
    expect(m.noChoice.total).toBe(1);
    expect(m.byOption.every((o) => o.total === 0)).toBe(true);
  });

  it("is empty for no RSVPs or no options", () => {
    expect(mealTotals([], OPTIONS).byOption.every((o) => o.total === 0)).toBe(true);
    expect(mealTotals([rsvp("ATTENDING", null)], [])).toEqual({ byOption: [], noChoice: { adults: 1, kids: 0, total: 1 }, adultMeals: 0, kidsMeals: 0 });
  });
});

describe("summarizeSubEvent()", () => {
  it("counts invited/attending/declined/pending and attending adults vs children", () => {
    const s = summarizeSubEvent(RSVPS, OPTIONS);
    expect(s).toMatchObject({ invited: 11, attending: 8, declined: 1, pending: 2, adults: 4, kids: 4 });
    expect(s.meals).toEqual(mealTotals(RSVPS, OPTIONS));
  });

  it("is all zeros for a sub-event with no invitations", () => {
    expect(summarizeSubEvent([], [])).toMatchObject({ invited: 0, attending: 0, declined: 0, pending: 0, adults: 0, kids: 0 });
  });
});

describe("reportAccess()", () => {
  const p = (over: Partial<Principal>): Principal => ({
    userId: "u", isPlatformAdmin: false, studioRoles: {}, eventRoles: {}, guestOf: new Set(), authMethod: "EMAIL_LINK", authedAt: new Date(), ...over,
  });
  const res = { studioId: "s1", eventId: "e1" };

  it("is names for hosts, planners, owners and staff; totals for vendors; null for everyone else", () => {
    expect(reportAccess(p({ eventRoles: { e1: ["HOST"] } }), res)).toBe("names");
    expect(reportAccess(p({ eventRoles: { e1: ["PLANNER"] } }), res)).toBe("names");
    expect(reportAccess(p({ studioRoles: { s1: "OWNER" } }), res)).toBe("names");
    expect(reportAccess(p({ studioRoles: { s1: "STAFF" } }), res)).toBe("names");
    expect(reportAccess(p({ eventRoles: { e1: ["VENDOR"] } }), res)).toBe("totals");
    expect(reportAccess(p({ guestOf: new Set(["e1"]) }), res)).toBeNull();
    expect(reportAccess(p({ eventRoles: { e9: ["HOST"] } }), res)).toBeNull();
    expect(reportAccess(null, res)).toBeNull();
  });
});
