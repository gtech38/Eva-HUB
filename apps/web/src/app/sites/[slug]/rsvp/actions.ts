"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, type RsvpStatus } from "@hub/db";
import { requireViewer } from "@/lib/site";
import { loadHousehold } from "./data";

/**
 * Writes one Rsvp row per (guest, sub-event) the household is invited to, fills in
 * plus-one names, and leaves an audit trail. The server-side household is the source
 * of truth for which fields are read; nothing in the form can address another household.
 */
export async function submitRsvp(formData: FormData) {
  const site = await requireViewer();
  if (!site) redirect("/");
  const { viewer, event } = site;
  if (!viewer.guest || !viewer.can("rsvp.respond")) redirect("/rsvp");

  const data = await loadHousehold(viewer.guest.householdId);
  if (!data || data.household.eventId !== event.id) redirect("/rsvp");

  const now = new Date();
  const summary: Array<{ guestId: string; subEventId: string; status: RsvpStatus; mealOptionId: string | null }> = [];
  const names: Array<{ guestId: string; firstName: string; lastName: string }> = [];

  for (const g of data.household.guests) {
    if (g.isPlusOne) {
      const first = String(formData.get(`name.${g.id}.first`) ?? "").trim().slice(0, 80);
      const last = String(formData.get(`name.${g.id}.last`) ?? "").trim().slice(0, 80);
      if (first || last) names.push({ guestId: g.id, firstName: first, lastName: last });
    }
    for (const inv of g.invites) {
      const raw = formData.get(`rsvp.${g.id}.${inv.subEventId}`);
      if (raw !== "ATTENDING" && raw !== "DECLINED") continue;
      let mealOptionId: string | null = null;
      if (raw === "ATTENDING" && inv.subEvent.servesMeal) {
        const chosen = String(formData.get(`meal.${g.id}.${inv.subEventId}`) ?? "");
        if (inv.subEvent.mealOptions.some((m) => m.id === chosen)) mealOptionId = chosen;
      }
      summary.push({ guestId: g.id, subEventId: inv.subEventId, status: raw, mealOptionId });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const n of names) {
      await tx.guest.update({ where: { id: n.guestId }, data: { firstName: n.firstName || null, lastName: n.lastName || null } });
    }
    for (const r of summary) {
      await tx.rsvp.upsert({
        where: { guestId_subEventId: { guestId: r.guestId, subEventId: r.subEventId } },
        create: { ...r, respondedAt: now, respondedByUserId: viewer.principal.userId },
        update: { status: r.status, mealOptionId: r.mealOptionId, respondedAt: now, respondedByUserId: viewer.principal.userId },
      });
    }
    await tx.auditLog.create({
      data: {
        studioId: event.studioId,
        eventId: event.id,
        actorUserId: viewer.principal.userId,
        action: "rsvp.respond",
        target: data.household.id,
        data: { responses: summary, renamed: names.map((n) => n.guestId) },
      },
    });
  });

  revalidatePath("/rsvp");
  redirect("/rsvp?saved=1");
}
