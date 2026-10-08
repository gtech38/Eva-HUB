/**
 * Route-level test for POST /api/face/search with the worker, Prisma and the site context faked at
 * their seams: no database, no worker, no selfie. Asserts what is written to BiometricConsent.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  writes: [] as Array<{ model: string; op: string; data: Record<string, unknown> }>,
  child: null as null | { id: string; faceSearchOptOut: boolean },
}));

vi.mock("@hub/db", async (importActual) => {
  const actual = await importActual<typeof import("@hub/db")>();
  const record = (model: string, op: string) => async (args: { data?: Record<string, unknown>; create?: Record<string, unknown> }) => {
    const data = args.data ?? args.create ?? {};
    db.writes.push({ model, op, data });
    return { id: `${model}-${db.writes.length}`, ...data };
  };
  const tx = {
    photoMatch: { upsert: record("photoMatch", "upsert") },
    biometricConsent: { create: record("biometricConsent", "create") },
    auditLog: { create: record("auditLog", "create") },
    $executeRaw: async () => 1,
  };
  return {
    ...actual,
    prisma: {
      guest: { findFirst: async () => db.child },
      $queryRaw: async () => [{ photoId: "photo-1", score: 0.9 }],
      photo: { findMany: async () => [{ id: "photo-1" }] },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

vi.mock("@/lib/gallery", () => ({
  visiblePhotoWhere: () => ({}),
  isEntitledFullRes: async () => false,
  toPhotoDTOs: async (photos: Array<{ id: string }>) => photos.map((p) => ({ id: p.id })),
}));

const viewerGuest = { id: "guest-adult", householdId: "hh-1", isChild: false, faceSearchOptOut: false };
vi.mock("@/lib/site", () => ({
  requireViewer: async () => ({
    event: { id: "event-1", studioId: "studio-1", faceSearchEnabled: true },
    viewer: { principal: { userId: "user-1" }, guest: viewerGuest, can: () => true },
  }),
}));

const { POST } = await import("./route.ts");

function selfieRequest(fields: Record<string, string>) {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "selfie.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new NextRequest("http://priya-arjun.localhost/api/face/search", { method: "POST", body: fd });
}

const consents = () => db.writes.filter((w) => w.model === "biometricConsent").map((w) => w.data);

beforeEach(() => {
  db.writes = [];
  db.child = null;
  const embedding = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, embedding, model: "test-model" })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/face/search consent records", () => {
  it("BiometricConsent.consentTextVersion for a self search equals SEARCH_SELF:v1-2026-10", async () => {
    const res = await POST(selfieRequest({ subject: "me", consent: "on" }));
    expect(res.status).toBe(200);
    expect(consents()).toStrictEqual([expect.objectContaining({ kind: "SEARCH_SELF", consentTextVersion: "SEARCH_SELF:v1-2026-10" })]);
  });

  it("a guardian search records the guardian text version", async () => {
    db.child = { id: "guest-child", faceSearchOptOut: false };
    const res = await POST(selfieRequest({ subject: "guest-child", consent: "on" }));
    expect(res.status).toBe(200);
    expect(consents()).toStrictEqual([
      expect.objectContaining({ kind: "SEARCH_GUARDIAN", subjectGuestId: "guest-child", consentTextVersion: "SEARCH_GUARDIAN:v1-2026-10" }),
    ]);
  });

  it("remember-my-face records the face profile text version alongside the search", async () => {
    const res = await POST(selfieRequest({ subject: "me", consent: "on", remember: "on" }));
    expect(res.status).toBe(200);
    expect(consents()).toStrictEqual([
      expect.objectContaining({ kind: "SEARCH_SELF", consentTextVersion: "SEARCH_SELF:v1-2026-10" }),
      expect.objectContaining({ kind: "FACE_PROFILE", consentTextVersion: "FACE_PROFILE:v1-2026-10" }),
    ]);
  });

  it("writes nothing without the consent box", async () => {
    const res = await POST(selfieRequest({ subject: "me" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({ ok: false, reason: "consent_required" });
    expect(db.writes).toStrictEqual([]);
  });
});
