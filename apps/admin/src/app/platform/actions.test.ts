/**
 * Wiring test for the platform `retryJob` server action: form parsing, the session, the revalidation
 * and the result shape. The rules themselves (platform.admin, FAILED/DEAD only, finishedAt reset, audit)
 * are tested in src/lib/jobActions.test.ts. next/cache and the session are mocked; Postgres is real
 * (skipped with a message when unreachable).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@hub/db";
import type { Principal } from "@hub/shared";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireSignedIn: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requireSignedIn } from "@/lib/auth";
import { retryJob } from "./actions";

const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const T = `TEST_ADM022_ACTIONS_${run}`;
const ACTOR = `test-actor-adm022-actions-${run}`;

const dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
if (!dbUp) console.log("# apps/admin platform/actions: Postgres unreachable -- skipping");

afterAll(async () => {
  if (dbUp) {
    await prisma.job.deleteMany({ where: { type: T } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: ACTOR } });
  }
  await prisma.$disconnect();
});

const as = (over: Partial<Principal>) =>
  vi.mocked(requireSignedIn).mockResolvedValue({ userId: ACTOR, isPlatformAdmin: false, studioRoles: {}, eventRoles: {}, guestOf: new Set(), authMethod: "EMAIL_LINK", authedAt: new Date(), ...over } as Awaited<ReturnType<typeof requireSignedIn>>);
const form = (id: bigint) => { const fd = new FormData(); fd.set("id", String(id)); return fd; };
const deadJob = () => prisma.job.create({ data: { type: T, payload: {}, status: "DEAD", attempts: 5, lastError: "boom", finishedAt: new Date(), runAt: new Date(Date.now() + 3_600_000) } });

describe.skipIf(!dbUp)("retryJob server action", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear());

  it("re-queues a DEAD job with a cleared finishedAt and revalidates the Jobs page", async () => {
    as({ isPlatformAdmin: true });
    const job = await deadJob();
    expect(await retryJob(null, form(job.id))).toEqual({ ok: true, message: "Re-queued" });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "QUEUED", attempts: 0, finishedAt: null });
    expect(revalidatePath).toHaveBeenCalledWith("/platform/jobs");
    await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() + 3_600_000) } }); // park before afterAll
  });

  it("returns the denial instead of retrying when the session is not a platform admin", async () => {
    as({ studioRoles: { s: "OWNER" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await deadJob();
    expect(await retryJob(null, form(job.id))).toMatchObject({ ok: false, error: expect.stringContaining("Forbidden") });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DEAD");
    expect(revalidatePath).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
