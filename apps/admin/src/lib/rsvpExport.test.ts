import { describe, expect, it } from "vitest";
import type { Principal } from "@hub/shared";
import { parseCsv } from "./csv";
import { summarizeSubEvent, type ReportAccess, type ReportGuestLine, type ReportRsvp, type RsvpReport } from "./guests";
import { rsvpExport, type ExportDeps, type ExportQuery } from "./rsvpExport";

const res = { studioId: "s1", eventId: "e1" };
const base = (over: Partial<Principal> = {}): Principal => ({
  userId: "u1", isPlatformAdmin: false, studioRoles: {}, eventRoles: {}, guestOf: new Set(),
  authMethod: "EMAIL_LINK", authedAt: new Date(), ...over,
});
const VENDOR = base({ userId: "vendor", eventRoles: { e1: ["VENDOR"] } });
const HOST = base({ userId: "host", eventRoles: { e1: ["HOST"] } });

const OPTIONS = [
  { id: "veg", label: { en: "Vegetarian" }, isKidsMeal: false },
  { id: "kids", label: { en: "Kids plate" }, isKidsMeal: true },
];
const RSVPS: ReportRsvp[] = [
  { status: "ATTENDING", mealOptionId: "veg", isChild: false },
  { status: "ATTENDING", mealOptionId: "kids", isChild: true },
  { status: "DECLINED", mealOptionId: null, isChild: false },
];
const GUESTS: ReportGuestLine[] = [
  { household: "The Rao Family", guest: "Lakshmi Rao", isChild: false, status: "ATTENDING", meal: "Vegetarian" },
  { household: "The Rao Family", guest: "=cmd|' /C calc'!A0", isChild: true, status: "ATTENDING", meal: "Kids plate" },
  { household: "Sharma", guest: "प्रिया शर्मा", isChild: false, status: "DECLINED", meal: "" },
];

/** Recording fakes: the report loader mimics loadRsvpReport (names only in "names" mode). */
function fakes(over: Partial<ExportDeps> = {}) {
  const audits: Array<Record<string, unknown>> = [];
  const loads: Array<{ access: ReportAccess; subEventId?: string }> = [];
  const deps: ExportDeps = {
    findEvent: async (studioId, eventId) => (studioId === "s1" && eventId === "e1" ? { id: "e1", slug: "priya-arjun" } : null),
    loadReport: async (eventId, access, opts) => {
      loads.push({ access, subEventId: opts?.subEventId });
      const report: RsvpReport = { access, subEvents: [] };
      if (eventId === "e1" && (!opts?.subEventId || opts.subEventId === "sub1")) {
        report.subEvents.push({
          id: "sub1", name: { en: "Wedding Ceremony" }, servesMeal: true, summary: summarizeSubEvent(RSVPS, OPTIONS),
          ...(access === "names" ? { guests: GUESTS } : {}),
        });
      }
      return report;
    },
    loadWideCsv: async () => [["household", "first_name"], ["The Rao Family", "Lakshmi"]],
    audit: async (entry) => { audits.push(entry); },
    ...over,
  };
  return { deps, audits, loads };
}

const q = (over: Partial<ExportQuery> = {}): ExportQuery => ({ subEventId: null, totals: false, ...over });
const rows = (body: string) => parseCsv(body);

describe("rsvpExport(): vendor limits", () => {
  it("VENDOR gets 403 from export without subEventId (the wide names CSV)", async () => {
    const { deps, audits, loads } = fakes();
    expect((await rsvpExport(VENDOR, res, q(), deps)).status).toBe(403);
    expect((await rsvpExport(VENDOR, res, q({ totals: true }), deps)).status).toBe(403);
    expect(loads).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("VENDOR gets 403 from the per-sub-event names CSV", async () => {
    const { deps, loads } = fakes();
    expect((await rsvpExport(VENDOR, res, q({ subEventId: "sub1" }), deps)).status).toBe(403);
    expect(loads).toEqual([]); // nothing name-level was even loaded
  });

  it("VENDOR gets 200 for export?subEventId=...&totals=1 with meal counts and no names", async () => {
    const { deps, loads } = fakes();
    const out = await rsvpExport(VENDOR, res, q({ subEventId: "sub1", totals: true }), deps);
    expect(out.status).toBe(200);
    expect(loads).toEqual([{ access: "totals", subEventId: "sub1" }]);
    expect(rows(out.body)).toEqual([
      ["meal", "kids_meal", "adults", "children", "total"],
      ["Vegetarian", "", "1", "0", "1"],
      ["Kids plate", "yes", "0", "1", "1"],
      ["No choice yet", "", "0", "0", "0"],
      ["Attending", "", "1", "1", "2"],
    ]);
    expect(out.body).not.toMatch(/Lakshmi|Rao|शर्मा/);
    expect(out.headers["Content-Disposition"]).toBe('attachment; filename="priya-arjun-wedding-ceremony-meals.csv"');
  });
});

describe("rsvpExport(): hosts and planners", () => {
  it("HOST gets the per-sub-event guest CSV with household, guest, is_child, status, meal", async () => {
    const { deps, loads } = fakes();
    const out = await rsvpExport(HOST, res, q({ subEventId: "sub1" }), deps);
    expect(out.status).toBe(200);
    expect(loads).toEqual([{ access: "names", subEventId: "sub1" }]);
    expect(rows(out.body)).toEqual([
      ["household", "guest", "is_child", "status", "meal"],
      ["The Rao Family", "Lakshmi Rao", "", "ATTENDING", "Vegetarian"],
      ["The Rao Family", "'=cmd|' /C calc'!A0", "yes", "ATTENDING", "Kids plate"], // formula neutralised
      ["Sharma", "प्रिया शर्मा", "", "DECLINED", ""],
    ]);
    expect(out.headers["Content-Disposition"]).toBe('attachment; filename="priya-arjun-wedding-ceremony-rsvp.csv"');
  });

  it("HOST gets the wide event CSV without subEventId", async () => {
    const { deps } = fakes();
    const out = await rsvpExport(HOST, res, q(), deps);
    expect(out.status).toBe(200);
    expect(rows(out.body)).toEqual([["household", "first_name"], ["The Rao Family", "Lakshmi"]]);
    expect(out.headers["Content-Disposition"]).toBe('attachment; filename="priya-arjun-rsvp.csv"');
  });

  it("HOST asking for totals loads totals only (no names) and totals without subEventId is a 400", async () => {
    const { deps, loads } = fakes();
    expect((await rsvpExport(HOST, res, q({ subEventId: "sub1", totals: true }), deps)).status).toBe(200);
    expect(loads).toEqual([{ access: "totals", subEventId: "sub1" }]);
    expect((await rsvpExport(HOST, res, q({ totals: true }), deps)).status).toBe(400);
  });

  it("every download is UTF-8 with a BOM and a text/csv content type", async () => {
    const { deps } = fakes();
    for (const query of [q(), q({ subEventId: "sub1" }), q({ subEventId: "sub1", totals: true })]) {
      const out = await rsvpExport(HOST, res, query, deps);
      expect(out.body.charCodeAt(0)).toBe(0xfeff);
      expect(out.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    }
  });
});

describe("rsvpExport(): scope and audit", () => {
  it("signed-out, guests, invite-link sessions and other studios get 403", async () => {
    const { deps } = fakes();
    expect((await rsvpExport(null, res, q({ subEventId: "sub1", totals: true }), deps)).status).toBe(403);
    expect((await rsvpExport(base({ guestOf: new Set(["e1"]) }), res, q({ subEventId: "sub1", totals: true }), deps)).status).toBe(403);
    expect((await rsvpExport(base({ authMethod: "INVITE_LINK", eventRoles: { e1: ["HOST"] } }), res, q({ subEventId: "sub1" }), deps)).status).toBe(403);
    expect((await rsvpExport(base({ studioRoles: { s2: "OWNER" } }), res, q(), deps)).status).toBe(403);
  });

  it("an event outside the studio or a sub-event outside the event is a 404", async () => {
    const { deps } = fakes();
    const owner = base({ studioRoles: { s1: "OWNER" } });
    expect((await rsvpExport(owner, { studioId: "s1", eventId: "e-other" }, q(), deps)).status).toBe(404);
    expect((await rsvpExport(VENDOR, res, q({ subEventId: "sub-of-another-event", totals: true }), deps)).status).toBe(404);
  });

  it("audits rsvp.export with subEventId, totals and the vendor flag", async () => {
    const { deps, audits } = fakes();
    await rsvpExport(VENDOR, res, q({ subEventId: "sub1", totals: true }), deps);
    await rsvpExport(HOST, res, q({ subEventId: "sub1" }), deps);
    await rsvpExport(HOST, res, q(), deps);
    expect(audits).toEqual([
      { studioId: "s1", eventId: "e1", actorUserId: "vendor", action: "rsvp.export", data: { rows: 4, subEventId: "sub1", totals: true, vendor: true } },
      { studioId: "s1", eventId: "e1", actorUserId: "host", action: "rsvp.export", data: { rows: 3, subEventId: "sub1", totals: false, vendor: false } },
      { studioId: "s1", eventId: "e1", actorUserId: "host", action: "rsvp.export", data: { rows: 1, subEventId: null, totals: false, vendor: false } },
    ]);
  });
});
