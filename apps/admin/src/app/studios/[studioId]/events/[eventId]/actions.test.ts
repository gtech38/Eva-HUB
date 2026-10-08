/**
 * Postgres-backed: schedule and settings changes that move the event end later re-extend the
 * event's active invitation tokens and audit `invite.extend` (ADM-005). Auth and cache
 * revalidation are faked; rows hang off a per-run studio and are removed in afterAll().
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@hub/db";

const DAY = 864e5;
const run = `test-adm005-ev-${Date.now()}`;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let principal: unknown = null;
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireSignedIn: async () => principal,
}));

const { saveSubEvent, updateEventSettings } = await import("./actions");

const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const skipReason = "Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up";
if (!dbUp) console.log(`# apps/admin events/actions: ${skipReason} -- skipping`);
const suite = dbUp ? "event actions re-extend invite tokens (Postgres)" : `event actions re-extend invite tokens [skipped: ${skipReason}]`;

let studioId = "";
let userId = "";
let n = 0;

async function fixture(startsOn: Date) {
  const slug = `${run}-${++n}`;
  const event = await prisma.event.create({ data: { studioId, slug, title: { en: slug }, startsOn, theme: "LUXURY" } });
  const household = await prisma.household.create({ data: { studioId, eventId: event.id, name: slug } });
  const guest = await prisma.guest.create({ data: { studioId, eventId: event.id, householdId: household.id, firstName: "Test", email: `${slug}@localhost` } });
  const original = new Date(startsOn.getTime() + 90 * DAY);
  const active = await prisma.inviteToken.create({ data: { tokenHash: `${slug}-a`, guestId: guest.id, channel: "EMAIL", sentTo: "t@localhost", expiresAt: original } });
  const revoked = await prisma.inviteToken.create({ data: { tokenHash: `${slug}-r`, guestId: guest.id, channel: "EMAIL", sentTo: "t@localhost", expiresAt: original, revokedAt: new Date() } });
  return { event, active, revoked, original };
}

function form(eventId: string, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ studioId, eventId, ...fields })) fd.append(k, v);
  return fd;
}

const expiry = async (id: string) => (await prisma.inviteToken.findUniqueOrThrow({ where: { id } })).expiresAt;
const extendAudits = (eventId: string) => prisma.auditLog.findMany({ where: { studioId, eventId, action: "invite.extend" } });

beforeAll(async () => {
  if (!dbUp) return;
  studioId = (await prisma.studio.create({ data: { slug: run, name: run } })).id;
  userId = (await prisma.user.create({ data: { displayName: run } })).id;
  principal = { userId, isPlatformAdmin: false, studioRoles: { [studioId]: "OWNER" }, eventRoles: {}, guestOf: new Set(), authMethod: "EMAIL_LINK", authedAt: new Date() };
});

afterAll(async () => {
  if (dbUp && studioId) {
    await prisma.auditLog.deleteMany({ where: { studioId } });
    await prisma.inviteToken.deleteMany({ where: { guest: { studioId } } });
    await prisma.guest.deleteMany({ where: { studioId } });
    await prisma.household.deleteMany({ where: { studioId } });
    await prisma.subEvent.deleteMany({ where: { event: { studioId } } });
    await prisma.domain.deleteMany({ where: { studioId } });
    await prisma.event.deleteMany({ where: { studioId } });
    await prisma.studio.deleteMany({ where: { id: studioId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  it("editing a sub-event to end later extends active tokens", async () => {
    const { event, active, revoked, original } = await fixture(new Date("2027-02-14T00:00:00Z"));
    const se = await prisma.subEvent.create({ data: { eventId: event.id, name: { en: "Reception" }, startsAt: new Date("2027-02-14T18:00:00Z"), endsAt: new Date("2027-02-14T22:00:00Z") } });

    const endsAt = "2027-02-16T02:00";
    const r = await saveSubEvent(null, form(event.id, { subEventId: se.id, "name.en": "Reception", startsAt: "2027-02-15T18:00", endsAt }));
    expect(r).toMatchObject({ ok: true });

    const want = new Date(new Date(endsAt).getTime() + 90 * DAY);
    expect(await expiry(active.id)).toEqual(want);
    expect(await expiry(revoked.id)).toEqual(original);
    const audits = await extendAudits(event.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data).toMatchObject({ count: 1, expiresAt: want.toISOString() });
  });

  it("adding a sub-event before the current end changes nothing and writes no audit", async () => {
    const { event, active, original } = await fixture(new Date("2027-04-10T00:00:00Z"));
    const r = await saveSubEvent(null, form(event.id, { "name.en": "Mehndi", startsAt: "2027-04-08T18:00", endsAt: "2027-04-08T22:00" }));
    expect(r).toMatchObject({ ok: true });
    expect(await expiry(active.id)).toEqual(original);
    expect(await extendAudits(event.id)).toHaveLength(0);
  });

  it("moving startsOn later in settings extends active tokens", async () => {
    const { event, active } = await fixture(new Date("2027-03-01T00:00:00Z"));
    const r = await updateEventSettings(null, form(event.id, {
      "title.en": event.slug, slug: event.slug, startsOn: "2027-03-20", timezone: "America/Chicago", status: "DRAFT",
      theme: "LUXURY", enabledLocales: "en", defaultLocale: "en", faceIndexRetentionDays: "",
    }));
    expect(r).toMatchObject({ ok: true });
    const want = new Date(new Date("2027-03-20T00:00:00").getTime() + 90 * DAY);
    expect(await expiry(active.id)).toEqual(want);
    expect(await extendAudits(event.id)).toHaveLength(1);
  });
});
