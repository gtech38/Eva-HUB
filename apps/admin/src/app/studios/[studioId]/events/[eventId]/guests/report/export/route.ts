import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getPrincipal } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { lt } from "@/lib/format";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await getPrincipal();
  if (!p || !can(p, "rsvp.report", { studioId, eventId })) return new NextResponse("Forbidden", { status: 403 });
  const event = await prisma.event.findFirst({ where: { id: eventId, studioId } });
  if (!event) return new NextResponse("Not found", { status: 404 });

  const subs = await prisma.subEvent.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }] });
  const guests = await prisma.guest.findMany({ where: { eventId, deletedAt: null }, include: { household: true, rsvps: { include: { mealOption: true } }, invites: true }, orderBy: [{ household: { name: "asc" } }, { createdAt: "asc" }] });
  const head = ["household", "first_name", "last_name", "email", "phone", "is_child", "is_plus_one", "linked_user", ...subs.flatMap((s) => [`${lt(s.name)} invited`, `${lt(s.name)} rsvp`, `${lt(s.name)} meal`])];
  const rows = guests.map((g) => [
    g.household.name, g.firstName ?? "", g.lastName ?? "", g.email ?? "", g.phone ?? "", g.isChild ? "yes" : "", g.isPlusOne ? "yes" : "", g.userId ? "yes" : "",
    ...subs.flatMap((s) => { const inv = g.invites.some((i) => i.subEventId === s.id); const r = g.rsvps.find((x) => x.subEventId === s.id); return [inv ? "yes" : "", inv ? (r?.status ?? "PENDING") : "", r?.mealOption ? lt(r.mealOption.label) : ""]; }),
  ]);
  await audit({ studioId, eventId, actorUserId: p.userId, action: "rsvp.export", data: { rows: rows.length } });
  return new NextResponse(toCsv([head, ...rows]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${event.slug}-rsvp.csv"` } });
}
