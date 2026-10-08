"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma, enqueue } from "@hub/db";
import { storage } from "@hub/shared";
import { act, str, opt, bool, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";

const base = (studioId: string, eventId: string) => `/studios/${studioId}/events/${eventId}/gallery`;

async function loadEvent(studioId: string, eventId: string) {
  const e = await prisma.event.findFirst({ where: { id: eventId, studioId } });
  if (!e) throw new Error("Event not found");
  return e;
}

// ───────────── Albums ─────────────

const AlbumInput = z.object({ title: z.string().min(1, "Title is required"), visibility: z.enum(["GUESTS", "HOSTS_ONLY", "HIDDEN"]), vendorVisible: z.boolean(), subEventId: z.string().nullable(), sortOrder: z.coerce.number().int().default(0) });

export async function saveAlbum(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "albums.manage", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const id = opt(fd, "albumId");
    const input = AlbumInput.parse({ title: str(fd, "title"), visibility: str(fd, "visibility"), vendorVisible: bool(fd, "vendorVisible"), subEventId: opt(fd, "subEventId"), sortOrder: str(fd, "sortOrder") || 0 });
    if (input.subEventId && !(await prisma.subEvent.findFirst({ where: { id: input.subEventId, eventId } }))) return { ok: false, error: "Sub-event not found" };
    const data = { title: { en: input.title }, visibility: input.visibility, vendorVisible: input.vendorVisible, subEventId: input.subEventId, sortOrder: input.sortOrder };
    if (id) {
      const ex = await prisma.album.findFirst({ where: { id, eventId } });
      if (!ex) return { ok: false, error: "Album not found" };
      await prisma.album.update({ where: { id }, data });
      if (ex.visibility !== input.visibility) await audit({ studioId, eventId, actorUserId: p.userId, action: "album.visibility", target: id, data: { from: ex.visibility, to: input.visibility } });
    } else {
      await prisma.album.create({ data: { studioId, eventId, ...data } });
    }
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: "Saved." };
  });
}

export async function deleteAlbum(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "albums.manage", { studioId, eventId });
    const id = str(fd, "albumId");
    const ex = await prisma.album.findFirst({ where: { id, eventId }, include: { _count: { select: { photos: true } } } });
    if (!ex) return { ok: false, error: "Album not found" };
    await prisma.$transaction([prisma.photo.updateMany({ where: { albumId: id }, data: { albumId: null } }), prisma.album.delete({ where: { id } })]);
    await audit({ studioId, eventId, actorUserId: p.userId, action: "album.delete", target: id, data: { photosUnassigned: ex._count.photos } });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: ex._count.photos ? `Album deleted; ${ex._count.photos} photos moved to Unassigned.` : "Album deleted." };
  });
}

// ───────────── Upload ─────────────

const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
const MAX_BYTES = 200 * 1024 * 1024;

export type BeginUploadResult =
  | { ok: true; duplicate: true; photoId: string; status: string }
  | { ok: true; duplicate: false; photoId: string; url: string; key: string; fallbackUrl: string }
  | { ok: false; error: string };

export async function beginUpload(input: { studioId: string; eventId: string; albumId: string | null; filename: string; size: number; type: string; sha256: string }): Promise<BeginUploadResult> {
  const p = await requireSignedIn();
  authorize(p, "photos.upload", { studioId: input.studioId, eventId: input.eventId });
  const { studioId, eventId } = input;
  await loadEvent(studioId, eventId);
  const ext = ALLOWED[input.type];
  if (!ext) return { ok: false, error: `Unsupported type ${input.type || "(unknown)"}; JPEG or PNG only.` };
  if (!(input.size > 0 && input.size <= MAX_BYTES)) return { ok: false, error: "File is empty or over 200 MB." };
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) return { ok: false, error: "Bad checksum." };
  if (input.albumId && !(await prisma.album.findFirst({ where: { id: input.albumId, eventId } }))) return { ok: false, error: "Album not found." };

  const dupe = await prisma.photo.findUnique({ where: { eventId_checksum: { eventId, checksum: input.sha256 } } });
  if (dupe) {
    if (dupe.status === "UPLOADING" || dupe.status === "FAILED") {
      // Stale or failed earlier attempt: allow re-upload under the same row.
      const url = await storage.presignUpload(dupe.originalKey, input.type);
      await prisma.photo.update({ where: { id: dupe.id }, data: { status: "UPLOADING", filename: input.filename, originalBytes: BigInt(input.size), albumId: input.albumId ?? dupe.albumId } });
      return { ok: true, duplicate: false, photoId: dupe.id, url, key: dupe.originalKey, fallbackUrl: `/api/upload?photoId=${dupe.id}` };
    }
    return { ok: true, duplicate: true, photoId: dupe.id, status: dupe.status };
  }

  const photo = await prisma.$transaction(async (tx) => {
    const created = await tx.photo.create({ data: { studioId, eventId, albumId: input.albumId, originalKey: "pending", originalBytes: BigInt(input.size), checksum: input.sha256, filename: input.filename.slice(0, 255), status: "UPLOADING" } });
    const key = storage.keys.original(studioId, eventId, created.id, ext);
    return tx.photo.update({ where: { id: created.id }, data: { originalKey: key } });
  });
  const url = await storage.presignUpload(photo.originalKey, input.type);
  return { ok: true, duplicate: false, photoId: photo.id, url, key: photo.originalKey, fallbackUrl: `/api/upload?photoId=${photo.id}` };
}

export async function completeUpload(input: { studioId: string; eventId: string; photoId: string }): Promise<{ ok: boolean; error?: string; status?: string }> {
  const p = await requireSignedIn();
  authorize(p, "photos.upload", { studioId: input.studioId, eventId: input.eventId });
  const photo = await prisma.photo.findFirst({ where: { id: input.photoId, eventId: input.eventId, studioId: input.studioId } });
  if (!photo) return { ok: false, error: "Photo not found" };
  if (photo.status !== "UPLOADING") return { ok: true, status: photo.status };
  const head = await storage.headObject(photo.originalKey);
  if (!head) return { ok: false, error: "Object not found in storage; upload didn't finish." };
  await prisma.photo.update({ where: { id: photo.id }, data: { status: "UPLOADED", originalBytes: BigInt(head.ContentLength ?? Number(photo.originalBytes)) } });
  await enqueue("PROCESS_PHOTO", { photoId: photo.id, eventId: photo.eventId, studioId: photo.studioId }, { dedupeKey: `process:${photo.id}` });
  revalidatePath(base(input.studioId, input.eventId));
  return { ok: true, status: "UPLOADED" };
}

export async function photoStatuses(input: { studioId: string; eventId: string; photoIds: string[] }) {
  const p = await requireSignedIn();
  authorize(p, "gallery.view", { studioId: input.studioId, eventId: input.eventId });
  const rows = await prisma.photo.findMany({ where: { id: { in: input.photoIds.slice(0, 200) }, eventId: input.eventId }, select: { id: true, status: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

// ───────────── Photos ─────────────

export async function setPhotoHidden(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "photos.hide", { studioId, eventId });
    const id = str(fd, "photoId"); const hidden = bool(fd, "hidden");
    const ex = await prisma.photo.findFirst({ where: { id, eventId } });
    if (!ex) return { ok: false, error: "Photo not found" };
    await prisma.photo.update({ where: { id }, data: { hidden } });
    // TODO: rotate derivative keys so already-shared URLs stop working (docs/01-architecture.md §5).
    await audit({ studioId, eventId, actorUserId: p.userId, action: hidden ? "photo.hide" : "photo.unhide", target: id });
    revalidatePath(base(studioId, eventId));
    return { ok: true };
  });
}

export async function movePhoto(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "albums.manage", { studioId, eventId });
    const id = str(fd, "photoId"); const albumId = opt(fd, "albumId");
    const ex = await prisma.photo.findFirst({ where: { id, eventId } });
    if (!ex) return { ok: false, error: "Photo not found" };
    if (albumId && !(await prisma.album.findFirst({ where: { id: albumId, eventId } }))) return { ok: false, error: "Album not found" };
    await prisma.photo.update({ where: { id }, data: { albumId } });
    revalidatePath(base(studioId, eventId));
    return { ok: true };
  });
}

export async function deletePhoto(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "albums.manage", { studioId, eventId });
    const id = str(fd, "photoId");
    const ex = await prisma.photo.findFirst({ where: { id, eventId } });
    if (!ex) return { ok: false, error: "Photo not found" };
    // Face/Favorite/PhotoMatch cascade in the schema; entitlements/order items reference by id without FK.
    await prisma.photo.delete({ where: { id } });
    // TODO: delete original + derivatives from S3 (worker-side cleanup job).
    await audit({ studioId, eventId, actorUserId: p.userId, action: "photo.delete", target: id, data: { key: ex.originalKey } });
    revalidatePath(base(studioId, eventId));
    return { ok: true };
  });
}

// ───────────── Entitlements & faces ─────────────

export async function grantGalleryUnlock(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "entitlements.grant", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const existing = await prisma.entitlement.findFirst({ where: { eventId, scope: "GALLERY_FULLRES", userId: null, revokedAt: null } });
    if (existing) return { ok: false, error: "Gallery is already unlocked." };
    const e = await prisma.entitlement.create({ data: { eventId, scope: "GALLERY_FULLRES", userId: null, orderId: null } });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "entitlement.grant", target: e.id, data: { scope: "GALLERY_FULLRES", comped: true } });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: "Gallery unlocked for all invited guests (comped)." };
  });
}

export async function revokeGalleryUnlock(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "entitlements.grant", { studioId, eventId });
    const r = await prisma.entitlement.updateMany({ where: { eventId, scope: "GALLERY_FULLRES", userId: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "entitlement.revoke", data: { scope: "GALLERY_FULLRES", count: r.count } });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: r.count ? "Gallery locked again (watermarked)." : "Nothing to revoke." };
  });
}

export async function reindexFaces(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "albums.manage", { studioId, eventId });
    const event = await loadEvent(studioId, eventId);
    if (!event.faceSearchEnabled) return { ok: false, error: "Face search is disabled for this event (Settings)." };
    await enqueue("CLUSTER_FACES", { eventId }, { dedupeKey: `cluster:${eventId}` });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "faceindex.reindex.request", target: eventId });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: "CLUSTER_FACES job queued." };
  });
}
