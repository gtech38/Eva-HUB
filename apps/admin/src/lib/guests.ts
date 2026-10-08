import { prisma, type RsvpStatus } from "@hub/db";
import { can, type Principal, type Resource } from "@hub/shared";
import { fullName, lt } from "@/lib/format";

// ───────────────────────────── RSVP report access ─────────────────────────────

/** "names": guest-level lists. "totals": headcounts and meal counts only (vendors). */
export type ReportAccess = "names" | "totals";

/** What this principal may see of the RSVP report; null when nothing. Decided by `can()` only. */
export function reportAccess(p: Principal | null, r: Resource): ReportAccess | null {
  if (!p || !can(p, "rsvp.report", r)) return null;
  return can(p, "rsvp.report.names", r) ? "names" : "totals";
}

/** One row of a sub-event's guest list (names mode only). `id` is the Rsvp row id (stable React key). */
export type ReportGuestLine = { id: string; household: string; guest: string; isChild: boolean; status: RsvpStatus; meal: string };
/** Invitation response counts. Hosts and planners see them; vendors ("meal counts only") do not. */
export type ResponseCounts = { invited: number; declined: number; pending: number };
export type SubEventReport = {
  id: string; name: unknown; servesMeal: boolean;
  /** Attending headcount and meal totals: all a vendor gets. */
  summary: SubEventTotals;
  /** Present only with access "names". */
  responses?: ResponseCounts;
  /** Present only with access "names". */
  guests?: ReportGuestLine[];
};
export type RsvpReport = {
  access: ReportAccess;
  subEvents: SubEventReport[];
  /** Present only with access "names". */
  households?: { total: number; withPending: number };
};

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

export type SubEventTotals = {
  attending: number;
  /** attending adults / children */
  adults: number; kids: number;
  meals: MealTotals;
};
export type SubEventSummary = SubEventTotals & ResponseCounts;

/** Headcounts for one sub-event (every Rsvp row is one invited guest). */
export function summarizeSubEvent(rsvps: readonly ReportRsvp[], options: readonly ReportMealOption[]): SubEventSummary {
  const n = (s: RsvpStatus) => rsvps.filter((r) => r.status === s).length;
  const kids = rsvps.filter((r) => r.status === "ATTENDING" && r.isChild).length;
  const attending = n("ATTENDING");
  return { invited: rsvps.length, attending, declined: n("DECLINED"), pending: n("PENDING"), adults: attending - kids, kids, meals: mealTotals(rsvps, options) };
}

/**
 * The one meal rule for every export and list: a meal is shown only for an attending guest who
 * picked one. Declined/pending guests may carry a stale choice; it is not a plate to cook.
 */
export function mealCell(r: { status: RsvpStatus; mealOption: { label: unknown } | null }): string {
  return r.status === "ATTENDING" && r.mealOption ? lt(r.mealOption.label) : "";
}

/**
 * Assemble one sub-event's report for `access`. Totals access never carries names or the
 * invited/declined/pending counts, whatever `lines` holds: this is the last line of defence.
 */
export function buildSubEventReport(
  sub: { id: string; name: unknown; servesMeal: boolean; mealOptions: readonly ReportMealOption[] },
  rsvps: readonly ReportRsvp[],
  access: ReportAccess,
  lines: readonly ReportGuestLine[] = [],
): SubEventReport {
  const { invited, declined, pending, ...summary } = summarizeSubEvent(rsvps, sub.mealOptions);
  const report: SubEventReport = { id: sub.id, name: sub.name, servesMeal: sub.servesMeal, summary };
  if (access === "names") {
    report.responses = { invited, declined, pending };
    report.guests = [...lines];
  }
  return report;
}

// ───────────────────────────── RSVP report loaders (Prisma) ─────────────────────────────

const SUB_ORDER = [{ sortOrder: "asc" as const }, { startsAt: "asc" as const }];
type EventRef = Required<Resource>;

/**
 * The RSVP report for an event (or one sub-event of it), shaped by what `can()` allows this
 * principal: null when they may not see the report at all. `totalsOnly` can only narrow. In
 * totals mode the guest select is `isChild` only, so names and contact details never leave the
 * database for vendors. Every query is scoped by studio and event; a `subEventId` from another
 * event yields no sub-events.
 */
export async function loadRsvpReport(p: Principal | null, r: EventRef, opts: { subEventId?: string; totalsOnly?: boolean } = {}): Promise<RsvpReport | null> {
  const allowed = reportAccess(p, r);
  if (!allowed) return null;
  const access: ReportAccess = opts.totalsOnly ? "totals" : allowed;
  const eventWhere = { id: r.eventId, studioId: r.studioId };
  const subs = await prisma.subEvent.findMany({
    where: { eventId: r.eventId, event: eventWhere, ...(opts.subEventId ? { id: opts.subEventId } : {}) },
    orderBy: SUB_ORDER,
    select: { id: true, name: true, servesMeal: true, mealOptions: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, isKidsMeal: true } } },
  });
  const where = { subEventId: { in: subs.map((s) => s.id) }, guest: { eventId: r.eventId, studioId: r.studioId, deletedAt: null } };
  const counts = await prisma.rsvp.findMany({ where, select: { subEventId: true, status: true, mealOptionId: true, guest: { select: { isChild: true } } } });
  const lines = access === "names" ? await guestLines(where) : [];

  const report: RsvpReport = {
    access,
    subEvents: subs.map((s) => {
      const rs = counts.filter((c) => c.subEventId === s.id).map((c) => ({ status: c.status, mealOptionId: c.mealOptionId, isChild: c.guest.isChild }));
      return buildSubEventReport(s, rs, access, lines.filter((l) => l.subEventId === s.id).map(({ subEventId: _, ...l }) => l));
    }),
  };
  if (access === "names") {
    const total = await prisma.household.count({ where: { eventId: r.eventId, studioId: r.studioId } });
    const withPending = await prisma.household.count({ where: { eventId: r.eventId, studioId: r.studioId, guests: { some: { deletedAt: null, rsvps: { some: { status: "PENDING" } } } } } });
    report.households = { total, withPending };
  }
  return report;
}

/** Name-level rows; only called for access "names". */
async function guestLines(where: { subEventId: { in: string[] }; guest: { eventId: string; studioId: string; deletedAt: null } }) {
  const rows = await prisma.rsvp.findMany({
    where,
    orderBy: [{ guest: { household: { name: "asc" } } }, { guest: { createdAt: "asc" } }, { id: "asc" }],
    select: {
      id: true, subEventId: true, status: true, mealOption: { select: { label: true } },
      guest: { select: { firstName: true, lastName: true, isPlusOne: true, isChild: true, household: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    subEventId: r.subEventId,
    household: r.guest.household.name,
    guest: fullName(r.guest),
    isChild: r.guest.isChild,
    status: r.status,
    meal: mealCell(r),
  }));
}

/**
 * The whole-event CSV table (one row per live guest, three columns per sub-event). Name-level, so
 * null unless `can()` grants `rsvp.report.names`.
 */
export async function loadWideCsv(p: Principal | null, r: EventRef): Promise<string[][] | null> {
  if (!p || !can(p, "rsvp.report.names", r)) return null;
  const subs = await prisma.subEvent.findMany({ where: { eventId: r.eventId, event: { id: r.eventId, studioId: r.studioId } }, orderBy: SUB_ORDER });
  const guests = await prisma.guest.findMany({ where: { eventId: r.eventId, studioId: r.studioId, deletedAt: null }, include: { household: true, rsvps: { include: { mealOption: true } }, invites: true }, orderBy: [{ household: { name: "asc" } }, { createdAt: "asc" }] });
  const head = ["household", "first_name", "last_name", "email", "phone", "is_child", "is_plus_one", "linked_user", ...subs.flatMap((s) => [`${lt(s.name)} invited`, `${lt(s.name)} rsvp`, `${lt(s.name)} meal`])];
  const rows = guests.map((g) => [
    g.household.name, g.firstName ?? "", g.lastName ?? "", g.email ?? "", g.phone ?? "", g.isChild ? "yes" : "", g.isPlusOne ? "yes" : "", g.userId ? "yes" : "",
    ...subs.flatMap((s) => { const inv = g.invites.some((i) => i.subEventId === s.id); const x = g.rsvps.find((y) => y.subEventId === s.id); return [inv ? "yes" : "", inv ? (x?.status ?? "PENDING") : "", x ? mealCell(x) : ""]; }),
  ]);
  return [head, ...rows];
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
