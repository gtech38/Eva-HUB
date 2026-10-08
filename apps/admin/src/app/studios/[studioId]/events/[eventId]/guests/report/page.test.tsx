/**
 * Page wiring against Postgres: the real page, loader and queries run on a self-seeded event; only
 * the session gate and `notFound()` are stubbed. The stubbed `requireAdmin` admits whatever
 * principal the test sets, which is what the layout will do for event-role users once ADM-029
 * lands; today's gate (studio.view) 404s them before this page runs.
 * Skipped without Postgres locally; fails when CI is set (see guests.db.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Principal } from "@hub/shared";
import { prisma } from "@hub/db";
import { principal, seedReportFixture, PHONE, type ReportFixture } from "../../../../../../../../test/reportFixture";

const gate = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => gate.current }));
vi.mock("@/lib/data", () => ({ getEvent: async () => ({}) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const { default: ReportPage } = await import("./page");

const run = `zp${Date.now().toString(36)}`;
const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);
if (!dbUp && inCi) {
  describe("report page", () => { it("requires Postgres when CI is set", () => { throw new Error("Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up"); }); });
}

describe.skipIf(!dbUp)("report page: who sees what", () => {
  let fx: ReportFixture;
  let cleanup: () => Promise<void> = async () => {};
  beforeAll(async () => { ({ fx, cleanup } = await seedReportFixture(run)); });
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  const render = async (p: Principal) => {
    gate.current = p;
    const el = await ReportPage({ params: Promise.resolve({ studioId: fx.studioId, eventId: fx.eventId }) });
    return renderToStaticMarkup(el);
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("host sees guest names, response counts, household figures and the name-level CSV links", async () => {
    const html = await render(principal({ eventRoles: { [fx.eventId]: ["HOST"] } }));
    expect(html).toContain(`Adult ${run}`);
    expect(html).toContain(fx.householdName);
    expect(html).toContain("Guest list CSV");
    expect(html).toContain("Export all (CSV)");
    expect(text(html)).toMatch(/1 households · 1 with at least one pending response/);
    expect(text(html)).toMatch(/4 invited/);
  });

  it("vendor sees meal counts only: no names, contacts, response counts, household figures or name-level links", async () => {
    const html = await render(principal({ eventRoles: { [fx.eventId]: ["VENDOR"] } }));
    expect(html).not.toContain(run);
    expect(html).not.toContain(PHONE.slice(1));
    expect(html).not.toContain("example.com");
    expect(html).not.toContain("Guest list CSV");
    expect(html).not.toContain("Export all");
    expect(text(html)).not.toMatch(/invited|declined|pending|households/);
    expect(text(html)).toMatch(/Vegetarian 1 0 1/);
    expect(text(html)).toMatch(/Kids plate \(kids\) 0 1 1/);
    expect(html).toContain("totals=1");
  });

  it("studio staff not assigned to the event get the vendor view, not names", async () => {
    const html = await render(principal({ studioRoles: { [fx.studioId]: "STAFF" } }));
    expect(html).not.toContain(run);
    expect(html).not.toContain("Guest list CSV");
  });

  it("people with no report access get a 404", async () => {
    await expect(render(principal({ guestOf: new Set([fx.eventId]) }))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
