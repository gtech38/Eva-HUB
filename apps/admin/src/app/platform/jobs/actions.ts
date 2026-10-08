"use server";
// tdd-exempt: thin server-action wiring (form parsing, session, revalidate); authorisation, rules and audit are in src/lib/jobActions.ts, tested by jobActions.test.ts

import { revalidatePath } from "next/cache";
import { act, str, type ActionState } from "@/lib/action";
import { requireSignedIn } from "@/lib/auth";
import { cancelJobAs, retryDeadJobsAs } from "@/lib/jobActions";

export async function cancelJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const r = await cancelJobAs(p, { id: BigInt(str(fd, "id")) });
    if (r.ok) revalidatePath("/platform/jobs");
    return r;
  });
}

export async function retryDeadJobs(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const r = await retryDeadJobsAs(p, str(fd, "type"));
    if (r.ok) revalidatePath("/platform/jobs");
    return r;
  });
}
