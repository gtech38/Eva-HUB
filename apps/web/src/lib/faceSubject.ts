/**
 * Who a viewer may search for (and read earlier matches of): themselves, or a child in their own
 * household. Shared by POST /api/face/search, GET /api/gallery/me and the /gallery/me page so the
 * guardian rule cannot drift between them. Opt-out always wins.
 */
import { prisma, type Guest } from "@hub/db";
import type { Viewer } from "./site";

export type FaceSubject = { kind: "me" } | { kind: "child"; guestId: string };
export type FaceSubjectResult = { ok: true; subject: FaceSubject } | { ok: false; reason: "forbidden" | "opted_out" };

type Guardian = Pick<Viewer, "guest">;

/** Live children of the viewer's household in this event. */
function householdChildren(guest: NonNullable<Guardian["guest"]>, eventId: string) {
  return { eventId, householdId: guest.householdId, isChild: true, deletedAt: null } as const;
}

/** `subject` is "me"/null for the viewer, otherwise the id of a child guest. */
export async function resolveFaceSubject(viewer: Guardian, eventId: string, subject: string | null): Promise<FaceSubjectResult> {
  if (subject === null || subject === "me") {
    return viewer.guest?.faceSearchOptOut ? { ok: false, reason: "opted_out" } : { ok: true, subject: { kind: "me" } };
  }
  if (!viewer.guest) return { ok: false, reason: "forbidden" };
  const child = await prisma.guest.findFirst({ where: { id: subject, ...householdChildren(viewer.guest, eventId) }, select: { id: true, faceSearchOptOut: true } });
  if (!child) return { ok: false, reason: "forbidden" };
  if (child.faceSearchOptOut) return { ok: false, reason: "opted_out" };
  return { ok: true, subject: { kind: "child", guestId: child.id } };
}

/** The children the viewer can pick as a search subject (opted-out children are not offered). */
export async function listSearchableChildren(viewer: Guardian, eventId: string): Promise<Guest[]> {
  if (!viewer.guest) return [];
  return prisma.guest.findMany({ where: { ...householdChildren(viewer.guest, eventId), faceSearchOptOut: false }, orderBy: { createdAt: "asc" } });
}
