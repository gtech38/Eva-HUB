/**
 * Authorisation, tenant scoping and auditing of the job actions (ADM-022), tested without Next: the
 * server actions in platform/jobs/actions.ts and events/[eventId]/jobs/actions.ts only parse the form,
 * call these functions and revalidate. Postgres-backed with its own studio and event (prefixed slugs,
 * removed in afterAll), so it needs no seed data and shares no rows with other suites. Without Postgres
 * it is skipped with a message locally and FAILS when CI is set (test/dbGuard.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hub/db";
import type { Principal } from "@hub/shared";
import { cancelJobAs, retryDeadJobsAs, retryJobAs } from "./jobActions";
import { ForbiddenError } from "./auth";
import { postgresUp } from "../../test/dbGuard";

const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const T = `TEST_ADM022_ACT_${run}`;
const ACTOR = `test-actor-adm022-${run}`;
const HOUR = 3_600_000;
const SUITE = "job actions against Postgres";

const dbUp = await postgresUp(SUITE);

/** This suite's own tenant; set in beforeAll. */
let event: { id: string; studioId: string } | undefined;
const made: { studio?: string; event?: string } = {};

afterAll(async () => {
  if (dbUp) {
    await prisma.job.deleteMany({ where: { type: { startsWith: T } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: ACTOR } });
    if (made.event) await prisma.event.deleteMany({ where: { id: made.event } });
    if (made.studio) await prisma.studio.deleteMany({ where: { id: made.studio } });
  }
  await prisma.$disconnect();
});

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: ACTOR, isPlatformAdmin: false, studioRoles: {}, eventRoles: {}, guestOf: new Set(), authMethod: "EMAIL_LINK", authedAt: new Date(), ...over,
});
const owner = () => principal({ studioRoles: { [event!.studioId]: "OWNER" } });
const staff = () => principal({ studioRoles: { [event!.studioId]: "STAFF" } });
const platformAdmin = () => principal({ isPlatformAdmin: true });

/** A scheduled (never due in real time) job carrying this suite's event id. */
const scheduled = (extra: Partial<Parameters<typeof prisma.job.create>[0]["data"]> = {}) =>
  prisma.job.create({ data: { type: T, payload: { eventId: event!.id }, runAt: new Date(Date.now() + HOUR), ...extra } });
const status = async (id: bigint) => (await prisma.job.findUniqueOrThrow({ where: { id } })).status;
const auditRows = (action: string, target: string) => prisma.auditLog.findMany({ where: { actorUserId: ACTOR, action, target } });

describe.skipIf(!dbUp)(SUITE, () => {
  beforeAll(async () => {
    const studio = await prisma.studio.create({ data: { slug: `t-adm022-${run}`, name: `ADM-022 ${run}` } });
    made.studio = studio.id;
    const e = await prisma.event.create({ data: { studioId: studio.id, slug: `adm022-${run}`, title: { en: `ADM-022 ${run}` }, theme: "LUXURY" } });
    made.event = e.id;
    event = { id: e.id, studioId: studio.id };
  });

  describe("event-scoped cancel (studio.manage: owner only)", () => {
    const input = (id: bigint, over: { studioId?: string; eventId?: string } = {}) => ({ id, scope: { studioId: event!.studioId, eventId: event!.id, ...over } });

    it("never falls through to the platform action when the form's ids are blank", async () => {
      const job = await scheduled();
      expect(await cancelJobAs(platformAdmin(), input(job.id, { studioId: "", eventId: "" }))).toEqual({ ok: false, error: "Event not found" });
      expect(await status(job.id)).toBe("QUEUED");
    });

    it("lets the studio owner cancel and writes job.cancel with the studio and event", async () => {
      const job = await scheduled();
      expect(await cancelJobAs(owner(), input(job.id))).toEqual({ ok: true, message: "Cancelled" });
      expect(await status(job.id)).toBe("DEAD");
      const [row] = await auditRows("job.cancel", String(job.id));
      expect(row).toMatchObject({ studioId: event!.studioId, eventId: event!.id });
      expect(row!.data).toEqual({ type: T });
    });

    it("refuses studio STAFF and leaves the job queued", async () => {
      const job = await scheduled();
      await expect(cancelJobAs(staff(), input(job.id))).rejects.toBeInstanceOf(ForbiddenError);
      expect(await status(job.id)).toBe("QUEUED");
      expect(await auditRows("job.cancel", String(job.id))).toEqual([]);
    });

    it("refuses an invitation-link session even for an owner", async () => {
      const job = await scheduled();
      await expect(cancelJobAs({ ...owner(), authMethod: "INVITE_LINK" }, input(job.id))).rejects.toBeInstanceOf(ForbiddenError);
      expect(await status(job.id)).toBe("QUEUED");
    });

    it("sends a stale (12 h+) owner session back to sign in instead of denying", async () => {
      const job = await scheduled();
      const stale = { ...owner(), authedAt: new Date(Date.now() - 13 * HOUR) };
      await expect(cancelJobAs(stale, input(job.id))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
      expect(await status(job.id)).toBe("QUEUED");
    });

    it("treats an event of another studio as not found, even for that studio's owner", async () => {
      const job = await scheduled();
      const otherStudio = "studio-that-does-not-own-the-event";
      const p = principal({ studioRoles: { [otherStudio]: "OWNER" } });
      expect(await cancelJobAs(p, input(job.id, { studioId: otherStudio }))).toEqual({ ok: false, error: "Event not found" });
      expect(await status(job.id)).toBe("QUEUED");
    });

    it("cannot cancel a job of another event of the same studio", async () => {
      const job = await scheduled({ payload: { eventId: "some-other-event" } });
      expect(await cancelJobAs(owner(), input(job.id))).toEqual({ ok: false, error: "Job not found" });
      expect(await status(job.id)).toBe("QUEUED");
    });

    it("job.cancel is refused for RUNNING jobs and writes no audit row", async () => {
      const job = await scheduled({ status: "RUNNING", lockedBy: "w", lockedAt: new Date() });
      const r = await cancelJobAs(owner(), input(job.id));
      expect(r).toMatchObject({ ok: false });
      expect(r.ok === false && r.error).toMatch(/running/i);
      expect(await status(job.id)).toBe("RUNNING");
      expect(await auditRows("job.cancel", String(job.id))).toEqual([]);
    });
  });

  describe("platform actions (platform.admin)", () => {
    it("cancels any queued job for a platform admin, without a studio or event", async () => {
      const job = await scheduled();
      expect(await cancelJobAs(platformAdmin(), { id: job.id })).toEqual({ ok: true, message: "Cancelled" });
      const [row] = await auditRows("job.cancel", String(job.id));
      expect(row).toMatchObject({ studioId: null, eventId: null });
    });

    it("refuses a studio owner on the platform scope", async () => {
      const job = await scheduled();
      await expect(cancelJobAs(owner(), { id: job.id })).rejects.toBeInstanceOf(ForbiddenError);
      expect(await status(job.id)).toBe("QUEUED");
    });

    it("retries dead jobs of a type for a platform admin and audits the count; refuses everyone else", async () => {
      const type = `${T}_DEAD`;
      await Promise.all([1, 2].map(() => scheduled({ type, status: "DEAD", attempts: 5, lastError: "x", finishedAt: new Date() })));
      await expect(retryDeadJobsAs(owner(), type)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await prisma.job.count({ where: { type, status: "DEAD" } })).toBe(2);

      expect(await retryDeadJobsAs(platformAdmin(), type)).toEqual({ ok: true, message: `Re-queued 2 dead ${type} job(s)` });
      expect(await prisma.job.count({ where: { type, status: "QUEUED", finishedAt: null } })).toBe(2);
      const [row] = await auditRows("job.retry.all", type);
      expect(row!.data).toEqual({ type, count: 2 });
      await prisma.job.updateMany({ where: { type }, data: { runAt: new Date(Date.now() + HOUR) } }); // park before afterAll
    });

    it("requires a job type", async () => {
      expect(await retryDeadJobsAs(platformAdmin(), "")).toEqual({ ok: false, error: "Job type is required" });
    });

    it("retries one FAILED/DEAD job with a fresh attempt budget and a cleared finishedAt, and audits job.retry", async () => {
      const job = await scheduled({ status: "DEAD", attempts: 5, lastError: "boom", lockedBy: "w", finishedAt: new Date() });
      await expect(retryJobAs(owner(), job.id)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await status(job.id)).toBe("DEAD");

      expect(await retryJobAs(platformAdmin(), job.id)).toEqual({ ok: true, message: "Re-queued" });
      const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(after).toMatchObject({ status: "QUEUED", attempts: 0, lockedBy: null, lockedAt: null, finishedAt: null });
      expect(after.runAt.getTime()).toBeLessThanOrEqual(Date.now());
      const [row] = await auditRows("job.retry", String(job.id));
      expect(row!.data).toEqual({ type: T });
      await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() + HOUR) } }); // park before afterAll
    });

    it("retry refuses jobs that are not FAILED/DEAD and unknown ids", async () => {
      const queued = await scheduled();
      expect(await retryJobAs(platformAdmin(), queued.id)).toEqual({ ok: false, error: "Job is QUEUED; only FAILED/DEAD jobs can be retried." });
      expect(await retryJobAs(platformAdmin(), BigInt("9007199254740991"))).toEqual({ ok: false, error: "Job not found" });
    });
  });
});
