/**
 * Postgres-backed: re-extending invitation tokens when an event's end date moves later
 * (ADM-005). Needs the local stack (pnpm infra:up); skipped with a message otherwise.
 * Every row hangs off a per-run studio and is deleted in afterAll().
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import { inviteExpiry } from "@hub/shared/invites";
import { extendInviteTokens } from "./inviteTokens";

const DAY = 864e5;
const run = `test-adm005-${Date.now()}`;
const d = (iso: string) => new Date(iso);

const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
const skipReason = "Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up";
if (!dbUp) console.log(`# apps/admin inviteTokens: ${skipReason} -- skipping`);
const suite = dbUp ? "extendInviteTokens against Postgres" : `extendInviteTokens against Postgres [skipped: ${skipReason}]`;

let studioId = "";

async function makeEvent(slug: string, startsOn: Date | null) {
  const event = await prisma.event.create({ data: { studioId, slug, title: { en: slug }, startsOn, theme: "LUXURY" } });
  const household = await prisma.household.create({ data: { studioId, eventId: event.id, name: `${slug} household` } });
  const guest = await prisma.guest.create({ data: { studioId, eventId: event.id, householdId: household.id, firstName: "Test", email: `${slug}@localhost` } });
  return { event, guest };
}

async function token(guestId: string, expiresAt: Date, revokedAt: Date | null = null) {
  return prisma.inviteToken.create({ data: { tokenHash: `${run}-${Math.random()}`, guestId, channel: "EMAIL", sentTo: "t@localhost", expiresAt, revokedAt } });
}

const expiresAt = async (id: string) => (await prisma.inviteToken.findUniqueOrThrow({ where: { id } })).expiresAt;

beforeAll(async () => {
  if (!dbUp) return;
  studioId = (await prisma.studio.create({ data: { slug: run, name: run } })).id;
});

afterAll(async () => {
  if (dbUp && studioId) {
    await prisma.inviteToken.deleteMany({ where: { guest: { studioId } } });
    await prisma.guest.deleteMany({ where: { studioId } });
    await prisma.household.deleteMany({ where: { studioId } });
    await prisma.subEvent.deleteMany({ where: { event: { studioId } } });
    await prisma.event.deleteMany({ where: { studioId } });
    await prisma.studio.deleteMany({ where: { id: studioId } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)(suite, () => {
  it("editing a sub-event to end later extends active tokens", async () => {
    const { event, guest } = await makeEvent(`${run}-a`, d("2027-02-14T00:00:00Z"));
    const reception = await prisma.subEvent.create({ data: { eventId: event.id, name: { en: "Reception" }, startsAt: d("2027-02-14T18:00:00Z"), endsAt: d("2027-02-14T23:00:00Z") } });
    const issuedFor = inviteExpiry({ startsOn: event.startsOn, subEvents: [reception] });
    const active = await token(guest.id, issuedFor);
    const revoked = await token(guest.id, issuedFor, new Date());

    const later = d("2027-02-16T02:00:00Z");
    await prisma.subEvent.update({ where: { id: reception.id }, data: { endsAt: later } });
    const result = await extendInviteTokens(studioId, event.id);

    const want = new Date(later.getTime() + 90 * DAY);
    expect(result).toEqual({ count: 1, expiresAt: want });
    expect(await expiresAt(active.id)).toEqual(want);
    expect(await expiresAt(revoked.id)).toEqual(issuedFor);
  });

  it("never shortens a token when the end date moves earlier", async () => {
    const { event, guest } = await makeEvent(`${run}-b`, d("2027-05-01T00:00:00Z"));
    const original = new Date(d("2027-05-01T00:00:00Z").getTime() + 90 * DAY);
    const t = await token(guest.id, original);
    await prisma.event.update({ where: { id: event.id }, data: { startsOn: d("2027-04-01T00:00:00Z") } });

    expect(await extendInviteTokens(studioId, event.id)).toEqual({ count: 0, expiresAt: new Date(d("2027-04-01T00:00:00Z").getTime() + 90 * DAY) });
    expect(await expiresAt(t.id)).toEqual(original);
  });

  it("never revives a token that has already expired", async () => {
    const { event, guest } = await makeEvent(`${run}-g`, d("2027-08-01T00:00:00Z"));
    const past = new Date(Date.now() - DAY);
    const dead = await token(guest.id, past);
    const live = await token(guest.id, d("2027-01-01T00:00:00Z"));

    expect(await extendInviteTokens(studioId, event.id)).toMatchObject({ count: 1 });
    expect(await expiresAt(dead.id)).toEqual(past);
    expect(await expiresAt(live.id)).toEqual(new Date(d("2027-08-01T00:00:00Z").getTime() + 90 * DAY));
  });

  it("leaves tokens of removed guests alone", async () => {
    const { event, guest } = await makeEvent(`${run}-h`, d("2027-08-01T00:00:00Z"));
    const exp = d("2027-01-01T00:00:00Z");
    const t = await token(guest.id, exp);
    await prisma.guest.update({ where: { id: guest.id }, data: { deletedAt: new Date() } });

    expect(await extendInviteTokens(studioId, event.id)).toMatchObject({ count: 0 });
    expect(await expiresAt(t.id)).toEqual(exp);
  });

  it("leaves tokens of other events alone", async () => {
    const mine = await makeEvent(`${run}-c`, d("2027-06-01T00:00:00Z"));
    const other = await makeEvent(`${run}-d`, d("2027-06-01T00:00:00Z"));
    const short = d("2027-01-01T00:00:00Z");
    const theirs = await token(other.guest.id, short);

    await extendInviteTokens(studioId, mine.event.id);
    expect(await expiresAt(theirs.id)).toEqual(short);
  });

  it("does nothing for an event with no dates", async () => {
    const { event, guest } = await makeEvent(`${run}-e`, null);
    const exp = d("2027-01-01T00:00:00Z");
    const t = await token(guest.id, exp);

    expect(await extendInviteTokens(studioId, event.id)).toBeNull();
    expect(await expiresAt(t.id)).toEqual(exp);
  });

  it("does nothing for an event outside the given studio", async () => {
    const { event, guest } = await makeEvent(`${run}-f`, d("2027-07-01T00:00:00Z"));
    const exp = d("2027-01-01T00:00:00Z");
    const t = await token(guest.id, exp);

    expect(await extendInviteTokens("not-this-studio", event.id)).toBeNull();
    expect(await expiresAt(t.id)).toEqual(exp);
  });
});
