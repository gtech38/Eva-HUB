"use server";

import { prisma } from "@hub/db";
import { requireViewer } from "@/lib/site";
import { visiblePhotoWhere } from "@/lib/gallery";

export async function toggleFavorite(photoId: string): Promise<{ ok: boolean; favorited: boolean }> {
  const site = await requireViewer();
  if (!site || !site.viewer.can("favorites")) return { ok: false, favorited: false };
  const { viewer, event } = site;

  // Only photos this viewer can actually see.
  const photo = await prisma.photo.findFirst({ where: visiblePhotoWhere(event.id, viewer, { id: photoId }), select: { id: true } });
  if (!photo) return { ok: false, favorited: false };

  const key = { userId_photoId: { userId: viewer.principal.userId, photoId } };
  const existing = await prisma.favorite.findUnique({ where: key });
  if (existing) {
    await prisma.favorite.delete({ where: key });
    return { ok: true, favorited: false };
  }
  await prisma.favorite.create({ data: { userId: viewer.principal.userId, photoId } });
  return { ok: true, favorited: true };
}
