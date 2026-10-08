import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSubEventReport, type ReportGuestLine, type ReportRsvp, type SubEventReport } from "@/lib/guests";
import { SubEventCard } from "./SubEventCard";

const OPTIONS = [
  { id: "veg", label: { en: "Vegetarian" }, isKidsMeal: false },
  { id: "kids", label: { en: "Kids plate" }, isKidsMeal: true },
];
const RSVPS: ReportRsvp[] = [
  { status: "ATTENDING", mealOptionId: "veg", isChild: false },
  { status: "ATTENDING", mealOptionId: "veg", isChild: false },
  { status: "ATTENDING", mealOptionId: "kids", isChild: true },
  { status: "DECLINED", mealOptionId: null, isChild: false },
  { status: "PENDING", mealOptionId: null, isChild: false },
];
const LINES: ReportGuestLine[] = [
  { id: "r1", household: "The Rao Family", guest: "Lakshmi Rao", isChild: false, status: "ATTENDING", meal: "Vegetarian" },
  { id: "r2", household: "The Rao Family", guest: "Ananya Rao", isChild: true, status: "ATTENDING", meal: "Kids plate" },
];
const sub = (access: "names" | "totals"): SubEventReport =>
  buildSubEventReport({ id: "sub1", name: { en: "Reception", te: "రిసెప్షన్" }, servesMeal: true, mealOptions: OPTIONS }, RSVPS, access, LINES);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const exportBase = "/studios/s1/events/e1/guests/report/export";

describe("SubEventCard", () => {
  it("host (names access) sees guest names, response counts and both CSV links", () => {
    const html = renderToStaticMarkup(<SubEventCard sub={sub("names")} access="names" exportBase={exportBase} />);
    expect(html).toContain("Lakshmi Rao");
    expect(html).toContain("Ananya Rao");
    expect(html).toContain("The Rao Family");
    expect(html).toContain(`href="${exportBase}?subEventId=sub1"`);
    expect(html).toContain(`href="${exportBase}?subEventId=sub1&amp;totals=1"`);
    expect(text(html)).toMatch(/5 invited/);
    expect(text(html)).toMatch(/1 declined/);
    expect(text(html)).toMatch(/1 pending/);
  });

  it("vendor (totals access) sees meal counts only: no names, no invited/declined/pending, no name-level CSV link", () => {
    const html = renderToStaticMarkup(<SubEventCard sub={sub("totals")} access="totals" exportBase={exportBase} />);
    for (const hidden of ["Lakshmi", "Ananya", "Rao Family", "Guest list CSV"]) expect(html).not.toContain(hidden);
    expect(html).not.toContain(`href="${exportBase}?subEventId=sub1"`);
    expect(html).toContain(`href="${exportBase}?subEventId=sub1&amp;totals=1"`);
    expect(text(html)).not.toMatch(/invited|declined|pending/);
    expect(html).toContain("Vegetarian");
    expect(html).toContain("Kids plate");
  });

  it("totals access still hides names if a names payload is passed by mistake", () => {
    const html = renderToStaticMarkup(<SubEventCard sub={sub("names")} access="totals" exportBase={exportBase} />);
    for (const hidden of ["Lakshmi", "Ananya", "Rao Family", "Guest list CSV"]) expect(html).not.toContain(hidden);
    expect(text(html)).not.toMatch(/invited|declined|pending/);
  });

  it("shows attending headcount and adult vs kids meal counts per option", () => {
    const t = text(renderToStaticMarkup(<SubEventCard sub={sub("totals")} access="totals" exportBase={exportBase} />));
    expect(t).toContain("Reception");
    expect(t).toMatch(/Attending: 2 adults · 1 children/);
    expect(t).toMatch(/2 adult meals · 1 kids meals/);
    expect(t).toMatch(/Vegetarian 2 0 2/);
    expect(t).toMatch(/Kids plate \(kids\) 0 1 1/);
  });
});
