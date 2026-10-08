import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { summarizeSubEvent, type ReportRsvp, type SubEventReport } from "@/lib/guests";
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
const sub = (withGuests: boolean): SubEventReport => ({
  id: "sub1",
  name: { en: "Reception", te: "రిసెప్షన్" },
  servesMeal: true,
  summary: summarizeSubEvent(RSVPS, OPTIONS),
  ...(withGuests
    ? { guests: [
        { household: "The Rao Family", guest: "Lakshmi Rao", isChild: false, status: "ATTENDING" as const, meal: "Vegetarian" },
        { household: "The Rao Family", guest: "Ananya Rao", isChild: true, status: "ATTENDING" as const, meal: "Kids plate" },
      ] }
    : {}),
});
const exportBase = "/studios/s1/events/e1/guests/report/export";

describe("SubEventCard", () => {
  it("host (names access) sees guest names and both CSV links", () => {
    const html = renderToStaticMarkup(<SubEventCard sub={sub(true)} access="names" exportBase={exportBase} />);
    expect(html).toContain("Lakshmi Rao");
    expect(html).toContain("Ananya Rao");
    expect(html).toContain("The Rao Family");
    expect(html).toContain(`href="${exportBase}?subEventId=sub1"`);
    expect(html).toContain(`href="${exportBase}?subEventId=sub1&amp;totals=1"`);
  });

  it("vendor (totals access) sees meal totals only: no names, no name-level CSV link", () => {
    // Even if a names payload were passed by mistake, the totals view must not render it.
    const html = renderToStaticMarkup(<SubEventCard sub={sub(true)} access="totals" exportBase={exportBase} />);
    expect(html).not.toContain("Lakshmi");
    expect(html).not.toContain("Ananya");
    expect(html).not.toContain("Rao Family");
    expect(html).not.toContain(`href="${exportBase}?subEventId=sub1"`);
    expect(html).toContain(`href="${exportBase}?subEventId=sub1&amp;totals=1"`);
    expect(html).toContain("Vegetarian");
    expect(html).toContain("Kids plate");
  });

  it("shows attending/declined/pending and adult vs kids meal counts", () => {
    const html = renderToStaticMarkup(<SubEventCard sub={sub(false)} access="totals" exportBase={exportBase} />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Reception");
    expect(text).toMatch(/3 attending/);
    expect(text).toMatch(/1 declined/);
    expect(text).toMatch(/1 pending/);
    expect(text).toMatch(/2 adult meals · 1 kids meals/);
    expect(text).toMatch(/Vegetarian 2 0 2/);
    expect(text).toMatch(/Kids plate \(kids\) 0 1 1/);
  });
});
