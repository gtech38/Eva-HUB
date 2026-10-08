import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { can, storage } from "@hub/shared";
import { getPrincipal } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Fallback for browsers that can't PUT straight to the bucket (no CORS on the
 * local S3). Streams the body through the server to the photo's original key.
 */
export async function PUT(req: NextRequest) {
  const photoId = req.nextUrl.searchParams.get("photoId") ?? "";
  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo) return new NextResponse("Not found", { status: 404 });
  const p = await getPrincipal();
  if (!p || !can(p, "photos.upload", { studioId: photo.studioId, eventId: photo.eventId })) return new NextResponse("Forbidden", { status: 403 });
  if (photo.status !== "UPLOADING") return new NextResponse("Photo not awaiting upload", { status: 409 });
  const type = req.headers.get("content-type") ?? "application/octet-stream";
  if (!["image/jpeg", "image/png"].includes(type)) return new NextResponse("Unsupported type", { status: 415 });
  const body = Buffer.from(await req.arrayBuffer());
  if (body.byteLength === 0) return new NextResponse("Empty body", { status: 400 });
  await storage.putObject(photo.originalKey, body, type);
  return NextResponse.json({ ok: true, bytes: body.byteLength });
}
