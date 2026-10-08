/**
 * Postgres-backed: invitation tokens issued by the admin actions expire at the event end
 * (latest sub-event, not just startsOn) + 90 days (ADM-005). Auth, cache revalidation and the
 * email/SMS adapters are faked; everything else runs against the local DB. Rows hang off a
 * per-run studio and are removed in afterAll().
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@hub/db";

const DAY = 864e5;
const run = `test-adm005-inv-${Date.now()}`;
const sent: Array<{ to: string; text?: string; body?: string }> = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@hub/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hub/shared")>()),
  email: () => ({ send: async (m: { to: string }) => { sent.push(m); return { providerId: `fake-${sent.length}` }; } }),
  sms: () => ({ send: async (m: { to: string }) => { sent.push(m); return { providerId: `fake-${sent.length}` }; } }),
}));
let principal: unknown = null;
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireSignedIn: async () => principal,
}));

const { sendInvitations, resendInvite, previewInvite } = await import("./actions");

const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const skipReason = "Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up";
if (!dbUp) console.log(`# apps/admin invites/actions: ${skipReason} -- skipping`);
const suite = dbUp ? "invite actions against Postgres" : `invite actions against Postgres [skipped: ${skipReason}]`;

let studioId = "";
let eventId = "";
let guestId = "";
const startsOn = new Date("2027-02-14T00:00:00Z");
const receptionEnd = new Date("2027-02-16T03:00:00Z");
const want = new Date(receptionEnd.getTime() + 90 * DAY);

function form(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ studioId, eventId, ...fields })) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}

beforeAll(async () => {
  if (!dbUp) return;
  studioId = (await prisma.studio.create({ data: { slug: run, name: run } })).id;
  const user = await prisma.user.create({ data: { displayName: run } });
  principal = { userId: user.id, isPlatformAdmin: false, studioRoles: { [studioId]: "OWNER" }, eventRoles: {}, guestOf: new Set(), authMethod: "EMAIL_LINK", authedAt: new Date() };
  const event = await prisma.event.create({ data: { studioId, slug: run, title: { en: run }, startsOn, theme: "LUXURY" } });
  eventId = event.id;
  await prisma.subEvent.createMany({
    data: [
      { eventId, name: { en: "Ceremony" }, startsAt: new Date("2027-02-14T15:00:00Z"), endsAt: new Date("2027-02-14T18:00:00Z") },
      { eventId, name: { en: "Reception" }, startsAt: new Date("2027-02-15T23:00:00Z"), endsAt: receptionEnd },
    ],
  });
  const household = await prisma.household.create({ data: { studioId, eventId, name: run } });
  guestId = (await prisma.guest.create({ data: { studioId, eventId, householdId: household.id, firstName: "Test", email: `${run}@localhost` } })).id;
});

afterAll(async () => {
  if (dbUp && studioId) {
    const p = principal as { userId?: string } | null;
    await prisma.auditLog.deleteMany({ where: { studioId } });
    await prisma.message.deleteMany({ where: { studioId } });
    await prisma.inviteToken.deleteMany({ where: { guest: { studioId } } });
    await prisma.guest.deleteMany({ where: { studioId } });
    await prisma.household.deleteMany({ where: { studioId } });
    await prisma.subEvent.deleteMany({ where: { event: { studioId } } });
    await prisma.event.deleteMany({ where: { studioId } });
    await prisma.studio.deleteMany({ where: { id: studioId } });
    if (p?.userId) await prisma.user.deleteMany({ where: { id: p.userId } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  // Each test starts from a guest with no tokens and an empty outbox, so order does not matter.
  beforeEach(async () => {
    await prisma.inviteToken.deleteMany({ where: { guestId } });
    sent.length = 0;
  });

  const linkSent = () => {
    expect(sent).toHaveLength(1);
    expect((sent[0] as { text?: string }).text).toContain("/i/");
  };

  it("sendInvitations issues tokens that expire at the reception end + 90 d", async () => {
    const r = await sendInvitations(null, form({ channels: "EMAIL", scope: "all", intro: "" }));
    expect(r).toMatchObject({ ok: true });
    const tokens = await prisma.inviteToken.findMany({ where: { guestId, revokedAt: null } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.expiresAt).toEqual(want);
    linkSent();
  });

  it("resendInvite revokes the old token and issues one with the same event-end expiry", async () => {
    const old = await prisma.inviteToken.create({ data: { tokenHash: `${run}-old`, guestId, channel: "EMAIL", sentTo: `${run}@localhost`, expiresAt: want } });
    const r = await resendInvite(null, form({ guestId }));
    expect(r).toMatchObject({ ok: true });
    expect((await prisma.inviteToken.findUniqueOrThrow({ where: { id: old.id } })).revokedAt).not.toBeNull();
    const live = await prisma.inviteToken.findMany({ where: { guestId, revokedAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0]!.id).not.toBe(old.id);
    expect(live[0]!.expiresAt).toEqual(want);
    linkSent();
  });

  it("previewInvite shows the same expiry", async () => {
    const r = await previewInvite(studioId, eventId, "");
    expect(r.expires).toBe(want.toISOString());
  });
});
