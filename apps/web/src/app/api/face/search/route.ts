import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { prisma, Prisma } from "@hub/db";
import { env } from "@hub/shared/env";
import { requireViewer } from "@/lib/site";
import { visiblePhotoWhere, isEntitledFullRes, toPhotoDTOs } from "@/lib/gallery";
import { CONSENT_TEXT_VERSION } from "@/lib/face";

export const dynamic = "force-dynamic";

const EMBEDDING_DIM = 128; // matches vector(128) in the schema

type WorkerOk = { ok: true; embedding: number[]; model: string };
type WorkerErr = { ok: false; reason: string };

const fail = (reason: string, status: number) => NextResponse.json({ ok: false, reason }, { status });

/**
 * Selfie → embedding (worker, synchronous) → pgvector match → PhotoMatch rows.
 * The selfie bytes are forwarded to the worker and never written anywhere.
 */
export async function POST(req: NextRequest) {
  const site = await requireViewer();
  if (!site) return fail("unauthorized", 401);
  const { event, viewer } = site;
  if (!viewer.can("face.search")) return fail("forbidden", 403);
  if (!event.faceSearchEnabled) return fail("disabled", 400);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("no_file", 400);
  if (file.size > 12 * 1024 * 1024) return fail("too_large", 413);
  if (form.get("consent") !== "on") return fail("consent_required", 400);
  const subject = String(form.get("subject") ?? "me");
  const remember = form.get("remember") === "on";

  // Who is being searched for? Me, or a child in my household (guardian search).
  let subjectGuestId: string | null = null;
  if (subject !== "me") {
    if (!viewer.guest) return fail("forbidden", 403);
    const child = await prisma.guest.findFirst({
      where: { id: subject, eventId: event.id, householdId: viewer.guest.householdId, isChild: true, deletedAt: null },
    });
    if (!child) return fail("forbidden", 403);
    if (child.faceSearchOptOut) return fail("opted_out", 403);
    subjectGuestId = child.id;
  } else if (viewer.guest?.faceSearchOptOut) {
    return fail("opted_out", 403);
  }

  // ── 1. Embed the selfie via the worker ──
  let embedding: number[];
  let model: string;
  try {
    const fd = new FormData();
    fd.append("file", file, file.name || "selfie.jpg");
    const res = await fetch(`${env().WORKER_INTERNAL_URL}/embed-selfie`, { method: "POST", body: fd, signal: AbortSignal.timeout(20_000) });
    if (!res.ok && res.status >= 500) return fail("unavailable", 503);
    const body = (await res.json()) as WorkerOk | WorkerErr;
    if (!body.ok) return fail(body.reason || "no_face", 422);
    embedding = body.embedding;
    model = body.model;
  } catch (err) {
    console.warn("[face-search] worker unreachable", (err as Error).message);
    return fail("unavailable", 503);
  }
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM || !embedding.every((x) => typeof x === "number" && Number.isFinite(x))) {
    console.error("[face-search] bad embedding from worker", { len: embedding?.length, model });
    return fail("unavailable", 503);
  }

  // ── 2. Match in SQL (cosine similarity = 1 - <=>) ──
  // The literal is built from validated finite numbers only, so inlining it is safe.
  const vec = Prisma.raw(`'[${embedding.map((x) => x.toPrecision(9)).join(",")}]'::vector`);
  const threshold = env().FACE_MATCH_THRESHOLD;
  let rows: Array<{ photoId: string; score: number }> = [];
  try {
    rows = await prisma.$queryRaw<Array<{ photoId: string; score: number }>>(Prisma.sql`
      SELECT f."photoId", MAX(1 - (f.embedding <=> ${vec})) AS score
      FROM "Face" f
      JOIN "Photo" p ON p.id = f."photoId"
      LEFT JOIN "FaceCluster" c ON c.id = f."clusterId"
      WHERE f."eventId" = ${event.id} AND p.status = 'READY' AND p.hidden = false AND COALESCE(c.suppressed, false) = false
      GROUP BY f."photoId"
      HAVING MAX(1 - (f.embedding <=> ${vec})) >= ${threshold}
      ORDER BY score DESC
      LIMIT 500
    `);
  } catch (err) {
    console.error("[face-search] match query failed", err);
    return fail("unavailable", 503);
  }

  // ── 3. Album visibility for this viewer ──
  const scores = new Map(rows.map((r) => [r.photoId, Number(r.score)]));
  const photos = rows.length
    ? await prisma.photo.findMany({ where: visiblePhotoWhere(event.id, viewer, { id: { in: [...scores.keys()] } }) })
    : [];
  photos.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));

  // ── 4. Persist: matches, consent, audit (and optional face profile) ──
  const ipHash = hashIp(req, env().AUTH_SECRET);
  await prisma.$transaction(async (tx) => {
    for (const p of photos) {
      const score = scores.get(p.id) ?? 0;
      if (subjectGuestId) {
        await tx.photoMatch.upsert({
          where: { subjectGuestId_photoId: { subjectGuestId, photoId: p.id } },
          create: { photoId: p.id, subjectGuestId, source: "GUARDIAN", score },
          update: { score, matchedAt: new Date() },
        });
      } else {
        await tx.photoMatch.upsert({
          where: { userId_photoId: { userId: viewer.principal.userId, photoId: p.id } },
          create: { photoId: p.id, userId: viewer.principal.userId, source: "SELFIE", score },
          update: { score, matchedAt: new Date() },
        });
      }
    }
    await tx.biometricConsent.create({
      data: {
        kind: subjectGuestId ? "SEARCH_GUARDIAN" : "SEARCH_SELF",
        consentedByUserId: viewer.principal.userId,
        subjectGuestId,
        eventId: event.id,
        consentTextVersion: CONSENT_TEXT_VERSION,
        ipHash,
      },
    });
    await tx.auditLog.create({
      data: {
        studioId: event.studioId,
        eventId: event.id,
        actorUserId: viewer.principal.userId,
        action: "face.search",
        target: subjectGuestId ?? viewer.principal.userId,
        data: { kind: subjectGuestId ? "SEARCH_GUARDIAN" : "SEARCH_SELF", candidates: rows.length, visible: photos.length, model },
      },
    });

    // "Remember my face": adults searching for themselves only. Embedding only, never the image.
    if (remember && !subjectGuestId && !viewer.guest?.isChild) {
      const consent = await tx.biometricConsent.create({
        data: { kind: "FACE_PROFILE", consentedByUserId: viewer.principal.userId, eventId: null, consentTextVersion: CONSENT_TEXT_VERSION, ipHash },
      });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "FaceProfile" (id, "userId", "consentId", "modelVersion", embedding, stale, "createdAt", "lastUsedAt", "purgeAfter")
        VALUES (${randomUUID()}, ${viewer.principal.userId}, ${consent.id}, ${model}, ${vec}, false, now(), now(), now() + interval '3 years')
        ON CONFLICT ("userId") DO UPDATE SET
          embedding = EXCLUDED.embedding, "modelVersion" = EXCLUDED."modelVersion", "consentId" = EXCLUDED."consentId",
          stale = false, "lastUsedAt" = now(), "purgeAfter" = now() + interval '3 years'
      `);
      await tx.auditLog.create({
        data: { studioId: event.studioId, eventId: null, actorUserId: viewer.principal.userId, action: "consent.grant", target: consent.id, data: { kind: "FACE_PROFILE" } },
      });
    }
  });

  const entitled = await isEntitledFullRes(event.id, viewer.principal.userId);
  const dtos = await toPhotoDTOs(photos, viewer, { entitled, scores });
  return NextResponse.json({ ok: true, subject, model, photos: dtos });
}

function hashIp(req: NextRequest, salt: string) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex") : null;
}
