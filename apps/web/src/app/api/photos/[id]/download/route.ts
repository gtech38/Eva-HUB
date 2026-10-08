import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { storage } from "@hub/shared";
import { requireViewer } from "@/lib/site";
import { visiblePhotoWhere, isEntitledFullRes } from "@/lib/gallery";

export const dynamic = "force-dynamic";

/** Full-resolution original. Re-checks visibility and entitlement, then 302s to a short presigned GET. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const site = await requireViewer();
  if (!site) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const { event, viewer } = site;
  if (!viewer.can("gallery.view")) return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const photo = await prisma.photo.findFirst({ where: visiblePhotoWhere(event.id, viewer, { id }) });
  if (!photo) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

  const entitled = viewer.isStudio || (await isEntitledFullRes(event.id, viewer.principal.userId));
  if (!entitled) return NextResponse.json({ ok: false, reason: "not_entitled" }, { status: 403 });

  await prisma.auditLog.create({
    data: { studioId: event.studioId, eventId: event.id, actorUserId: viewer.principal.userId, action: "photo.download", target: photo.id },
  });
  const url = await storage.presignDownload(photo.originalKey, 300, photo.filename);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
