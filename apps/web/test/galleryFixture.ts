/**
 * Postgres fixture for the gallery tests: one studio, two events, albums of every visibility and
 * a main album holding 125 visible photos plus every kind of photo that must never be listed.
 * Everything carries a per-run prefix and `cleanup()` removes it, so the suites are rerunnable
 * and never touch seed data.
 */
import { describe, it } from "vitest";
import { prisma } from "@hub/db";
import type { Viewer } from "@/lib/site";

export const VISIBLE_IN_MAIN = 125;

const pad = (n: number, w = 3) => String(n).padStart(w, "0");
const sortKeyFor = (group: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0) + group * 1000).toISOString().slice(0, 23);

export async function dbReachable(): Promise<boolean> {
  return prisma.$queryRaw`SELECT 1`.then(
    () => true,
    () => false,
  );
}

const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);

/**
 * Locally a DB-backed suite skips when Postgres is down; under CI that would hide privacy checks,
 * so register a failing test instead (same convention as apps/admin guests.db.test.ts).
 */
export function failInCiWithoutPostgres(label: string, dbUp: boolean): void {
  if (dbUp || !inCi) return;
  describe(label, () => {
    it("requires Postgres when CI is set", () => {
      throw new Error("Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up");
    });
  });
}

/** A Viewer with only the fields the gallery helpers read; override per test. */
export function fakeViewer(userId: string, over: Partial<Viewer> = {}): Viewer {
  return {
    principal: { userId } as Viewer["principal"],
    guest: null,
    seesAllSubEvents: false,
    canHostsOnlyAlbums: false,
    isStudio: false,
    can: () => true,
    ...over,
  };
}

/** Remove everything a fixture run created, keyed by its prefix, so a half-built fixture is cleaned too. */
async function cleanupRun(run: string) {
  const studio = await prisma.studio.findUnique({ where: { slug: `${run}-s` }, select: { id: true } });
  if (studio) {
    const eventIds = (await prisma.event.findMany({ where: { studioId: studio.id }, select: { id: true } })).map((e) => e.id);
    await prisma.entitlement.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.household.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.photo.deleteMany({ where: { eventId: { in: eventIds } } }); // cascades favorites + matches
    await prisma.album.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.studio.delete({ where: { id: studio.id } });
  }
  await prisma.user.deleteMany({ where: { displayName: { startsWith: `${run} ` } } });
}

export async function createGalleryFixture() {
  const run = `gt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    return await buildGalleryFixture(run);
  } catch (e) {
    await cleanupRun(run);
    throw e;
  }
}

async function buildGalleryFixture(run: string) {
  const studio = await prisma.studio.create({ data: { slug: `${run}-s`, name: `${run} studio` } });
  const mkEvent = (suffix: string) =>
    prisma.event.create({ data: { studioId: studio.id, slug: `${run}-${suffix}`, title: { en: run }, theme: "LUXURY", status: "LIVE" } });
  const [eventA, eventB] = [await mkEvent("a"), await mkEvent("b")];
  const mkAlbum = (eventId: string, visibility: "GUESTS" | "HOSTS_ONLY" | "HIDDEN") =>
    prisma.album.create({ data: { studioId: studio.id, eventId, title: { en: visibility }, visibility } });
  const albums = {
    main: await mkAlbum(eventA.id, "GUESTS"),
    hostsOnly: await mkAlbum(eventA.id, "HOSTS_ONLY"),
    hidden: await mkAlbum(eventA.id, "HIDDEN"),
    otherEvent: await mkAlbum(eventB.id, "GUESTS"),
  };
  const users = {
    viewer: await prisma.user.create({ data: { displayName: `${run} viewer` } }),
    other: await prisma.user.create({ data: { displayName: `${run} other` } }),
  };

  type Row = { id: string; eventId: string; albumId: string; sortKey: string | null; status?: "READY" | "UPLOADED"; hidden?: boolean };
  const rows: Row[] = [];
  const add = (r: Row) => rows.push(r);
  const id = (tag: string, i: number) => `${run}-${tag}${pad(i)}`;

  // 125 visible photos in groups of 7 sharing a sortKey (a group straddles the 60-photo page
  // boundary, so the id tiebreak is what keeps pages gap-free); the last five have no sortKey yet.
  const mainIds: string[] = [];
  for (let i = 0; i < VISIBLE_IN_MAIN; i++) {
    const rowId = id("m", i);
    mainIds.push(rowId);
    add({ id: rowId, eventId: eventA.id, albumId: albums.main.id, sortKey: i < 120 ? sortKeyFor(Math.floor(i / 7)) : null });
  }
  // Never listed: hidden, not yet processed, and (below) other albums / other events.
  for (let i = 0; i < 5; i++) add({ id: id("h", i), eventId: eventA.id, albumId: albums.main.id, sortKey: sortKeyFor(i * 4), hidden: true });
  for (let i = 0; i < 5; i++) add({ id: id("u", i), eventId: eventA.id, albumId: albums.main.id, sortKey: sortKeyFor(i * 3), status: "UPLOADED" });
  const hostsOnlyIds = [0, 1, 2, 3].map((i) => id("o", i));
  hostsOnlyIds.forEach((rowId, i) => add({ id: rowId, eventId: eventA.id, albumId: albums.hostsOnly.id, sortKey: sortKeyFor(i) }));
  const hiddenAlbumIds = [0, 1].map((i) => id("d", i));
  hiddenAlbumIds.forEach((rowId, i) => add({ id: rowId, eventId: eventA.id, albumId: albums.hidden.id, sortKey: sortKeyFor(i) }));
  const otherEventIds = [0, 1, 2].map((i) => id("x", i));
  otherEventIds.forEach((rowId, i) => add({ id: rowId, eventId: eventB.id, albumId: albums.otherEvent.id, sortKey: sortKeyFor(i) }));

  await prisma.photo.createMany({
    data: rows.map((r) => ({
      id: r.id,
      studioId: studio.id,
      eventId: r.eventId,
      albumId: r.albumId,
      originalKey: `${run}/orig/${r.id}.jpg`,
      originalBytes: BigInt(1),
      checksum: r.id,
      filename: `${r.id}.jpg`,
      status: r.status ?? "READY",
      hidden: r.hidden ?? false,
      sortKey: r.sortKey,
      derivatives: { thumb: `${run}/d/${r.id}-t.jpg`, web: `${run}/d/${r.id}-w.jpg`, webWm: `${run}/d/${r.id}-wm.jpg` },
    })),
  });

  /** Main-album ids in the order the feed must return them: sortKey asc, nulls last, then id. */
  const expectedMainOrder = [...mainIds].sort((a, b) => {
    const ka = rows.find((r) => r.id === a)!.sortKey;
    const kb = rows.find((r) => r.id === b)!.sortKey;
    if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka < kb ? -1 : 1;
    return a < b ? -1 : 1;
  });

  // Two households in event A: the viewer's own (an adult, a child, a child who opted out) and another family's child.
  const mkHousehold = (name: string) => prisma.household.create({ data: { studioId: studio.id, eventId: eventA.id, name: `${run} ${name}` } });
  const [home, away] = [await mkHousehold("home"), await mkHousehold("away")];
  const mkGuest = (householdId: string, data: { isChild?: boolean; faceSearchOptOut?: boolean; deletedAt?: Date; userId?: string }) =>
    prisma.guest.create({ data: { studioId: studio.id, eventId: eventA.id, householdId, firstName: "G", ...data } });
  const guests = {
    adult: await mkGuest(home.id, { userId: users.viewer.id }),
    child: await mkGuest(home.id, { isChild: true }),
    optedOutChild: await mkGuest(home.id, { isChild: true, faceSearchOptOut: true }),
    deletedChild: await mkGuest(home.id, { isChild: true, deletedAt: new Date() }),
    otherHouseholdChild: await mkGuest(away.id, { isChild: true }),
  };

  return {
    run,
    studio,
    eventA,
    eventB,
    albums,
    users,
    households: { home, away },
    guests,
    mainIds,
    expectedMainOrder,
    hostsOnlyIds,
    hiddenAlbumIds,
    otherEventIds,
    cleanup: () => cleanupRun(run),
  };
}
