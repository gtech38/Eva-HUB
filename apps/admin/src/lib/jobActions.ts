/**
 * Job actions with their rules (ADM-022). The server actions (platform/jobs/actions.ts and
 * events/[eventId]/jobs/actions.ts) parse the form, call these and revalidate; authorisation, the
 * tenant check and the audit row live here so they are unit-tested.
 */
import { prisma } from "@hub/db";
import type { Principal } from "@hub/shared";
import { authorize } from "./auth";
import { audit } from "./audit";
import { cancelJob, retryDeadOfType } from "./jobQueries";

export type JobActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Cancel a QUEUED job (never a RUNNING one). Without `scope` this is the platform action
 * (`platform.admin`, any job). With `scope` it is the event action, whatever the ids contain (blank ids
 * from a malformed form never widen it to the platform action): `studio.manage` (the studio owner), the
 * event must belong to that studio, and only jobs whose `payload.eventId` matches can be reached.
 * `authorize` throws ForbiddenError, or redirects a session that only failed the 12 h re-auth gate.
 */
export async function cancelJobAs(p: Principal, input: { id: bigint; scope?: { studioId: string; eventId: string } }): Promise<JobActionResult> {
  const { id, scope } = input;
  if (scope) {
    authorize(p, "studio.manage", scope);
    const event = await prisma.event.findFirst({ where: { id: scope.eventId, studioId: scope.studioId }, select: { id: true } });
    if (!event) return { ok: false, error: "Event not found" };
  } else {
    authorize(p, "platform.admin", { studioId: "" });
  }
  const r = await cancelJob(id, scope ? { eventId: scope.eventId } : {});
  if (!r.ok) return r;
  await audit({ studioId: scope?.studioId, eventId: scope?.eventId, actorUserId: p.userId, action: "job.cancel", target: String(id), data: { type: r.type } });
  return { ok: true, message: "Cancelled" };
}

/**
 * Platform admin only: re-queue one FAILED/DEAD job now with a fresh attempt budget. `finishedAt` is
 * cleared with the rest of the previous run (as `enqueue` does on a dedupe re-run) so the dashboard
 * does not count a revived job as a failure of the last hour.
 */
export async function retryJobAs(p: Principal, id: bigint): Promise<JobActionResult> {
  authorize(p, "platform.admin", { studioId: "" });
  const job = await prisma.job.findUnique({ where: { id }, select: { status: true, type: true } });
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status !== "FAILED" && job.status !== "DEAD") return { ok: false, error: `Job is ${job.status}; only FAILED/DEAD jobs can be retried.` };
  const { count } = await prisma.job.updateMany({
    where: { id, status: { in: ["FAILED", "DEAD"] } },
    data: { status: "QUEUED", attempts: 0, lockedAt: null, lockedBy: null, finishedAt: null, runAt: new Date() },
  });
  if (count === 0) return { ok: false, error: "Job changed state; reload and try again." };
  await audit({ actorUserId: p.userId, action: "job.retry", target: String(id), data: { type: job.type } });
  return { ok: true, message: "Re-queued" };
}

/** Platform admin only: re-queue every DEAD job of `type` (including ones an owner cancelled). */
export async function retryDeadJobsAs(p: Principal, type: string): Promise<JobActionResult> {
  authorize(p, "platform.admin", { studioId: "" });
  if (!type) return { ok: false, error: "Job type is required" };
  const count = await retryDeadOfType(type);
  await audit({ actorUserId: p.userId, action: "job.retry.all", target: type, data: { type, count } });
  return { ok: true, message: `Re-queued ${count} dead ${type} job(s)` };
}
