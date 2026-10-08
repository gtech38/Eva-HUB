"use server";
// tdd-exempt: thin server-action wiring (form parsing, session, revalidate); studio.manage, the studio/event tenant check and the audit row are in src/lib/jobActions.ts, tested by jobActions.test.ts

import { revalidatePath } from "next/cache";
import { act, str, type ActionState } from "@/lib/action";
import { requireSignedIn } from "@/lib/auth";
import { cancelJobAs } from "@/lib/jobActions";

/** Owner only (`studio.manage`); the job must belong to this event (`payload.eventId`). */
export async function cancelEventJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    const r = await cancelJobAs(p, { id: BigInt(str(fd, "id")), scope: { studioId, eventId } });
    if (r.ok) revalidatePath(`/studios/${studioId}/events/${eventId}/jobs`);
    return r;
  });
}
