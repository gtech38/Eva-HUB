// tdd-exempt: test fixture helper shared by the Postgres-backed report tests; exercised by them.
import { prisma } from "@hub/db";
import type { Principal } from "@hub/shared";

/**
 * Self-contained RSVP-report fixture: its own studio, two events, sub-events, meal options,
 * household and guests, all stamped with a per-run marker so tests can prove names and contact
 * details never reach a totals-only payload. Every id is recorded the moment its row is created,
 * so `cleanup()` removes exactly what exists even when seeding throws midway.
 */
export type ReportFixture = Awaited<ReturnType<typeof seedReportFixture>>["fx"];

export const PHONE = "+15125550199";

const TABLES = ["rsvp", "subEventInvite", "guest", "household", "mealOption", "subEvent", "event", "studio"] as const;
type Made = Record<(typeof TABLES)[number], string[]>;

export function principal(over: Partial<Principal> = {}): Principal {
  return { userId: "u-fixture", isPlatformAdmin: false, studioRoles: {}, eventRoles: {}, guestOf: new Set(), authMethod: "EMAIL_LINK", authedAt: new Date(), ...over };
}

export async function seedReportFixture(run: string) {
  const made: Made = { rsvp: [], subEventInvite: [], guest: [], household: [], mealOption: [], subEvent: [], event: [], studio: [] };

  async function cleanup() {
    await prisma.rsvp.deleteMany({ where: { id: { in: made.rsvp } } });
    // SubEventInvite has a composite key: delete by guest.
    await prisma.subEventInvite.deleteMany({ where: { guestId: { in: made.guest } } });
    await prisma.guest.deleteMany({ where: { id: { in: made.guest } } });
    await prisma.household.deleteMany({ where: { id: { in: made.household } } });
    await prisma.mealOption.deleteMany({ where: { id: { in: made.mealOption } } });
    await prisma.subEvent.deleteMany({ where: { id: { in: made.subEvent } } });
    await prisma.event.deleteMany({ where: { id: { in: made.event } } });
    await prisma.studio.deleteMany({ where: { id: { in: made.studio } } });
  }

  try {
    const studio = await prisma.studio.create({ data: { slug: `t-${run}`, name: `${run} Studio` } });
    made.studio.push(studio.id);
    const mkEvent = async (suffix: string) => {
      const e = await prisma.event.create({ data: { studioId: studio.id, slug: `${run}-${suffix}`, title: { en: `${run} ${suffix}` }, theme: "LUXURY" } });
      made.event.push(e.id);
      return e;
    };
    const event = await mkEvent("a");
    const otherEvent = await mkEvent("b");

    const mkSub = async (eventId: string, name: string, servesMeal: boolean, sortOrder: number) => {
      const s = await prisma.subEvent.create({ data: { eventId, name: { en: name }, startsAt: new Date("2027-01-01T18:00:00Z"), servesMeal, sortOrder } });
      made.subEvent.push(s.id);
      return s;
    };
    const dinner = await mkSub(event.id, "Dinner", true, 1);
    const haldi = await mkSub(event.id, "Haldi", false, 0);
    const otherSub = await mkSub(otherEvent.id, "Other dinner", true, 0);

    const mkMeal = async (label: string, isKidsMeal: boolean, sortOrder: number) => {
      const m = await prisma.mealOption.create({ data: { subEventId: dinner.id, label: { en: label }, isKidsMeal, sortOrder } });
      made.mealOption.push(m.id);
      return m;
    };
    const veg = await mkMeal("Vegetarian", false, 0);
    const nonveg = await mkMeal("Non-vegetarian", false, 1);
    const kids = await mkMeal("Kids plate", true, 2);

    const household = await prisma.household.create({ data: { eventId: event.id, studioId: studio.id, name: `${run} Household` } });
    made.household.push(household.id);

    const mkGuest = async (firstName: string, over: { isChild?: boolean; deletedAt?: Date } = {}) => {
      const g = await prisma.guest.create({
        data: {
          eventId: event.id, studioId: studio.id, householdId: household.id, firstName, lastName: run,
          email: over.isChild ? null : `${firstName.toLowerCase()}.${run}@example.com`, phone: over.isChild ? null : PHONE,
          isChild: over.isChild ?? false, deletedAt: over.deletedAt ?? null,
        },
      });
      made.guest.push(g.id);
      return g;
    };
    const mkRsvp = async (guestId: string, subEventId: string, status: "ATTENDING" | "DECLINED" | "PENDING", mealOptionId: string | null) => {
      await prisma.subEventInvite.create({ data: { guestId, subEventId } }); // removed with its guest in cleanup()
      const r = await prisma.rsvp.create({ data: { guestId, subEventId, status, mealOptionId } });
      made.rsvp.push(r.id);
      return r;
    };

    const adult = await mkGuest("Adult");
    const child = await mkGuest("Child", { isChild: true });
    const removed = await mkGuest("Removed", { deletedAt: new Date() });
    const declined = await mkGuest("Declined");
    const pending = await mkGuest("Pending");

    await mkRsvp(adult.id, dinner.id, "ATTENDING", veg.id);
    await mkRsvp(child.id, dinner.id, "ATTENDING", kids.id);
    await mkRsvp(removed.id, dinner.id, "ATTENDING", veg.id); // soft-deleted: never counted
    await mkRsvp(declined.id, dinner.id, "DECLINED", nonveg.id); // stale choice: not a plate
    await mkRsvp(pending.id, dinner.id, "PENDING", null);
    await mkRsvp(adult.id, haldi.id, "ATTENDING", null);

    return {
      fx: {
        run, studioId: studio.id, eventId: event.id, otherEventId: otherEvent.id,
        dinnerId: dinner.id, haldiId: haldi.id, otherSubId: otherSub.id,
        meals: { veg: veg.id, nonveg: nonveg.id, kids: kids.id },
        householdName: household.name,
      },
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
