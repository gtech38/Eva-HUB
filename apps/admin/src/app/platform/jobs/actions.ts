"use server";
// tdd-exempt: thin server-action wiring (authorize + one lib/jobQueries call + audit); cancel/retry logic is tested in src/lib/jobQueries.test.ts and src/lib/jobs.test.ts

import { revalidatePath } from "next/cache";
import { act, str, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cancelJob, retryDeadOfType } from "@/lib/jobQueries";

export async function cancelJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    authorize(p, "platform.admin", { studioId: "" });
    const id = BigInt(str(fd, "id"));
    const r = await cancelJob(id);
    if (!r.ok) return r;
    await audit({ actorUserId: p.userId, action: "job.cancel", target: String(id), data: { type: r.type } });
    revalidatePath("/platform/jobs");
    return { ok: true, message: "Cancelled" };
  });
}

export async function retryDeadJobs(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    authorize(p, "platform.admin", { studioId: "" });
    const type = str(fd, "type");
    if (!type) return { ok: false, error: "Job type is required" };
    const count = await retryDeadOfType(type);
    await audit({ actorUserId: p.userId, action: "job.retry.all", target: type, data: { type, count } });
    revalidatePath("/platform/jobs");
    return { ok: true, message: `Re-queued ${count} dead ${type} job(s)` };
  });
}
