import { prisma, type RsvpStatus } from "@hub/db";
import { lt } from "@/lib/format";

// ───────────────────────────── RSVP report aggregation (pure) ─────────────────────────────

/** One guest × sub-event answer, flattened for counting. Carries no names on purpose. */
export type ReportRsvp = { status: RsvpStatus; mealOptionId: string | null; isChild: boolean };
export type ReportMealOption = { id: string; label: unknown; isKidsMeal: boolean };
export type HeadCount = { adults: number; kids: number; total: number };
export type MealLine = HeadCount & { optionId: string; label: unknown; isKidsMeal: boolean };
export type MealTotals = { byOption: MealLine[]; noChoice: HeadCount; adultMeals: number; kidsMeals: number };

const zero = (): HeadCount => ({ adults: 0, kids: 0, total: 0 });
const bump = (h: HeadCount, isChild: boolean) => { if (isChild) h.kids++; else h.adults++; h.total++; };

/**
 * Meal plates for the caterer: attending guests only, per option in the given order, split by who
 * eats them (adult/child guest) and by plate type (`MealOption.isKidsMeal`). A meal id that is not
 * one of `options` counts as "no choice" so the lines always add up to the attending headcount.
 */
export function mealTotals(rsvps: readonly ReportRsvp[], options: readonly ReportMealOption[]): MealTotals {
  const byOption: MealLine[] = options.map((o) => ({ optionId: o.id, label: o.label, isKidsMeal: o.isKidsMeal, ...zero() }));
  const index = new Map(byOption.map((l) => [l.optionId, l]));
  const noChoice = zero();
  for (const r of rsvps) {
    if (r.status !== "ATTENDING") continue;
    bump((r.mealOptionId && index.get(r.mealOptionId)) || noChoice, r.isChild);
  }
  const plates = (kids: boolean) => byOption.filter((l) => l.isKidsMeal === kids).reduce((n, l) => n + l.total, 0);
  return { byOption, noChoice, adultMeals: plates(false), kidsMeals: plates(true) };
}

export type SubEventSummary = {
  invited: number; attending: number; declined: number; pending: number;
  /** attending adults / children */
  adults: number; kids: number;
  meals: MealTotals;
};

/** Headcounts for one sub-event (every Rsvp row is one invited guest). */
export function summarizeSubEvent(rsvps: readonly ReportRsvp[], options: readonly ReportMealOption[]): SubEventSummary {
  const n = (s: RsvpStatus) => rsvps.filter((r) => r.status === s).length;
  const kids = rsvps.filter((r) => r.status === "ATTENDING" && r.isChild).length;
  const attending = n("ATTENDING");
  return { invited: rsvps.length, attending, declined: n("DECLINED"), pending: n("PENDING"), adults: attending - kids, kids, meals: mealTotals(rsvps, options) };
}

/** Make a guest's SubEventInvite + Rsvp rows match `wanted`. Answered RSVPs are never removed. */
export async function syncInvites(eventId: string, guestId: string, wanted: Set<string>) {
  const subs = await prisma.subEvent.findMany({ where: { eventId }, select: { id: true, name: true } });
  const invites = await prisma.subEventInvite.findMany({ where: { guestId } });
  const rsvps = await prisma.rsvp.findMany({ where: { guestId } });
  const blocked: string[] = [];
  for (const s of subs) {
    const has = invites.some((i) => i.subEventId === s.id);
    if (wanted.has(s.id) && !has) {
      await prisma.subEventInvite.create({ data: { guestId, subEventId: s.id } });
      await prisma.rsvp.upsert({ where: { guestId_subEventId: { guestId, subEventId: s.id } }, create: { guestId, subEventId: s.id, status: "PENDING" }, update: {} });
    } else if (!wanted.has(s.id) && has) {
      const r = rsvps.find((x) => x.subEventId === s.id);
      if (r && r.status !== "PENDING") { blocked.push(lt(s.name)); continue; }
      await prisma.rsvp.deleteMany({ where: { guestId, subEventId: s.id } });
      await prisma.subEventInvite.delete({ where: { guestId_subEventId: { guestId, subEventId: s.id } } });
    }
  }
  return { blocked };
}
