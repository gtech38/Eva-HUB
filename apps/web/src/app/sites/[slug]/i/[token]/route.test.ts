/**
 * Postgres-backed: the personal invitation link route (ADM-005). A dead link (expired, revoked or
 * unknown) lands on the sign-in form with an expiry explanation instead of a bare error; a live
 * link opens an INVITE_LINK session that never outlives the token. `getSite()` is faked (it reads
 * request headers); rows hang off a per-run studio and are removed in afterAll().
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { hashToken } from "@hub/shared/auth";

const DAY = 864e5;
const run = `test-adm005-web-${Date.now()}`;
const ORIGIN = "http://adm005.localhost:3000";
let site: { slug: string; event: { id: string; studioId: string } } | null = null;

vi.mock("@/lib/site", () => ({ getSite: async () => site, siteOrigin: () => ORIGIN }));

const { GET } = await import("./route");

const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const skipReason = "Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up";
if (!dbUp) console.log(`# apps/web /i/[token]: ${skipReason} -- skipping`);
const suite = dbUp ? "/i/[token] against Postgres" : `/i/[token] against Postgres [skipped: ${skipReason}]`;

let studioId = "";
let guestId = "";
let n = 0;

async function token(o: { expiresAt: Date; revokedAt?: Date | null }) {
  const raw = `${run}-${++n}`;
  const row = await prisma.inviteToken.create({ data: { tokenHash: hashToken(raw), guestId, channel: "EMAIL", sentTo: `${run}@localhost`, expiresAt: o.expiresAt, revokedAt: o.revokedAt ?? null } });
  return { raw, row };
}

const open = (raw: string) => GET(new NextRequest(`${ORIGIN}/i/${raw}`), { params: Promise.resolve({ token: raw }) });

beforeAll(async () => {
  if (!dbUp) return;
  studioId = (await prisma.studio.create({ data: { slug: run, name: run } })).id;
  const event = await prisma.event.create({ data: { studioId, slug: run, title: { en: run }, theme: "LUXURY" } });
  const household = await prisma.household.create({ data: { studioId, eventId: event.id, name: run } });
  guestId = (await prisma.guest.create({ data: { studioId, eventId: event.id, householdId: household.id, firstName: "Test", email: `${run}@localhost` } })).id;
  site = { slug: run, event: { id: event.id, studioId } };
});

afterAll(async () => {
  if (dbUp && studioId) {
    const users = await prisma.contactPoint.findMany({ where: { value: `${run}@localhost` }, select: { userId: true } });
    const userIds = users.map((u) => u.userId);
    await prisma.auditLog.deleteMany({ where: { studioId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.inviteToken.deleteMany({ where: { guest: { studioId } } });
    await prisma.guest.deleteMany({ where: { studioId } });
    await prisma.household.deleteMany({ where: { studioId } });
    await prisma.event.deleteMany({ where: { studioId } });
    await prisma.studio.deleteMany({ where: { id: studioId } });
    await prisma.contactPoint.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  it("an expired token lands on the sign-in form with the expiry notice, without a session", async () => {
    const { raw } = await token({ expiresAt: new Date(Date.now() - DAY) });
    const res = await open(raw);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/?invite=expired`);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a revoked token lands on the same expiry notice", async () => {
    const { raw } = await token({ expiresAt: new Date(Date.now() + 30 * DAY), revokedAt: new Date() });
    const res = await open(raw);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/?invite=expired`);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("an unknown token lands on the same expiry notice", async () => {
    const res = await open(`${run}-nope`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/?invite=expired`);
  });

  it("a live token opens an INVITE_LINK session that ends when the token expires", async () => {
    const expiresAt = new Date(Date.now() + 5 * DAY);
    const { raw } = await token({ expiresAt });
    const res = await open(raw);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/rsvp`);
    expect(res.headers.get("set-cookie")).toContain("hub_session=");
    const cp = await prisma.contactPoint.findUniqueOrThrow({ where: { kind_value: { kind: "EMAIL", value: `${run}@localhost` } } });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: cp.userId }, orderBy: { authedAt: "desc" } });
    expect(session.authMethod).toBe("INVITE_LINK");
    expect(session.expiresAt).toEqual(expiresAt);
  });
});
