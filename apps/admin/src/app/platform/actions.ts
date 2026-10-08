"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@hub/db";
import { act, EmailSchema, str, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { retryJobAs } from "@/lib/jobActions";
import { userForEmail } from "@/lib/users";

const CreateStudio = z.object({
  name: z.string().min(2, "Name is required"),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes only"),
  ownerEmail: EmailSchema("Enter the owner's email"),
});

export async function createStudio(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    authorize(p, "platform.admin", { studioId: "" });
    const input = CreateStudio.parse({ name: str(fd, "name"), slug: str(fd, "slug"), ownerEmail: str(fd, "ownerEmail") });
    if (await prisma.studio.findUnique({ where: { slug: input.slug } })) return { ok: false, fieldErrors: { slug: ["Slug already in use"] }, error: "Please fix the highlighted fields." };

    const owner = await userForEmail(input.ownerEmail);
    const studio = await prisma.studio.create({
      data: {
        name: input.name,
        slug: input.slug,
        brandJson: { credit: `Photography by ${input.name}`, url: "", logoText: input.name.slice(0, 2).toUpperCase() },
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    });
    await audit({ studioId: studio.id, actorUserId: p.userId, action: "studio.create", target: studio.id, data: { slug: input.slug, ownerEmail: input.ownerEmail } });
    revalidatePath("/platform");
    return { ok: true, message: `Created studio "${input.name}" with ${input.ownerEmail} as owner.` };
  });
}

export async function retryJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const r = await retryJobAs(p, BigInt(str(fd, "id"))); // authorises platform.admin, audits job.retry
    if (r.ok) revalidatePath("/platform/jobs");
    return r;
  });
}
