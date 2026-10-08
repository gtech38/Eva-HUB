import { can, type Principal, type Resource } from "@hub/shared";
import { csvFile } from "@/lib/csv";
import { lt, slugify } from "@/lib/format";
import { reportAccess, type ReportAccess, type RsvpReport, type SubEventReport } from "@/lib/guests";

type Cell = string | number | null | undefined;

/** `?subEventId=` and `?totals=1` from the export URL. */
export type ExportQuery = { subEventId: string | null; totals: boolean };

/** I/O the export needs; the route passes Prisma-backed implementations, tests pass fakes. */
export type ExportDeps = {
  /** The event, only if it belongs to the studio. */
  findEvent(studioId: string, eventId: string): Promise<{ id: string; slug: string } | null>;
  loadReport(eventId: string, access: ReportAccess, opts?: { subEventId?: string }): Promise<RsvpReport>;
  /** The whole-event, one-row-per-guest CSV (header first). Name-level. */
  loadWideCsv(eventId: string): Promise<Cell[][]>;
  audit(entry: { studioId: string; eventId: string; actorUserId: string; action: string; data: { rows: number; subEventId: string | null; totals: boolean; vendor: boolean } }): Promise<void>;
};

export type ExportResult = { status: number; body: string; headers: Record<string, string> };

const fail = (status: number, body: string): ExportResult => ({ status, body, headers: {} });

/**
 * RSVP CSV export. Three shapes:
 * - no `subEventId`: the wide whole-event guest CSV (names; `rsvp.report.names`)
 * - `subEventId`: that sub-event's guest list (names; `rsvp.report.names`)
 * - `subEventId` + `totals`: that sub-event's meal counts (`rsvp.report`; the only shape vendors get)
 * Name-level shapes are refused before anything is loaded. Every download is audited.
 */
export async function rsvpExport(p: Principal | null, r: Required<Resource>, q: ExportQuery, deps: ExportDeps): Promise<ExportResult> {
  const access = reportAccess(p, r);
  if (!p || !access) return fail(403, "Forbidden");
  const totalsOnly = Boolean(q.subEventId && q.totals);
  if (!totalsOnly && !can(p, "rsvp.report.names", r)) return fail(403, "Forbidden");
  if (q.totals && !q.subEventId) return fail(400, "totals=1 needs a subEventId");

  const event = await deps.findEvent(r.studioId, r.eventId);
  if (!event) return fail(404, "Not found");

  let table: Cell[][];
  let file: string;
  if (q.subEventId) {
    const report = await deps.loadReport(event.id, totalsOnly ? "totals" : "names", { subEventId: q.subEventId });
    const sub = report.subEvents.find((s) => s.id === q.subEventId);
    if (!sub) return fail(404, "Not found");
    table = totalsOnly ? totalsTable(sub) : guestTable(sub);
    file = `${event.slug}-${slugify(lt(sub.name)) || sub.id}-${totalsOnly ? "meals" : "rsvp"}.csv`;
  } else {
    table = await deps.loadWideCsv(event.id);
    file = `${event.slug}-rsvp.csv`;
  }

  await deps.audit({
    studioId: r.studioId, eventId: r.eventId, actorUserId: p.userId, action: "rsvp.export",
    data: { rows: Math.max(0, table.length - 1), subEventId: q.subEventId, totals: totalsOnly, vendor: access === "totals" },
  });
  return {
    status: 200,
    body: csvFile(table),
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
  };
}

/** Caterer sheet: one line per meal option, then no-choice and the attending total. No names. */
export function totalsTable(sub: SubEventReport): Cell[][] {
  const { meals, adults, kids, attending } = sub.summary;
  return [
    ["meal", "kids_meal", "adults", "children", "total"],
    ...meals.byOption.map((m) => [lt(m.label), m.isKidsMeal ? "yes" : "", m.adults, m.kids, m.total]),
    ["No choice yet", "", meals.noChoice.adults, meals.noChoice.kids, meals.noChoice.total],
    ["Attending", "", adults, kids, attending],
  ];
}

/** Guest list for one sub-event. Requires a report loaded with access "names". */
export function guestTable(sub: SubEventReport): Cell[][] {
  if (!sub.guests) throw new Error("guestTable needs a names report");
  return [
    ["household", "guest", "is_child", "status", "meal"],
    ...sub.guests.map((g) => [g.household, g.guest, g.isChild ? "yes" : "", g.status, g.meal]),
  ];
}
