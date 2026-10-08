"use server";
// tdd-exempt: thin server-action wiring (authorize + tenant check + one lib/jobQueries call + audit); cancel logic and its event scoping are tested in src/lib/jobQueries.test.ts

import { revalidatePath } from "next/cache";
import { prisma } from "@hub/db";
import { act, str, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cancelJob } from "@/lib/jobQueries";

/** Owner only (`studio.manage`); the job must belong to this event (`payload.eventId`). */
export async function cancelEventJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "studio.manage", { studioId, eventId });
    const event = await prisma.event.findFirst({ where: { id: eventId, studioId }, select: { id: true } });
    if (!event) return { ok: false, error: "Event not found" };
    const id = BigInt(str(fd, "id"));
    const r = await cancelJob(id, { eventId });
    if (!r.ok) return r;
    await audit({ studioId, eventId, actorUserId: p.userId, action: "job.cancel", target: String(id), data: { type: r.type } });
    revalidatePath(`/studios/${studioId}/events/${eventId}/jobs`);
    return { ok: true, message: "Cancelled" };
  });
}
