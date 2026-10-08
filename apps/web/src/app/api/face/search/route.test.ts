/**
 * Route-level test for POST /api/face/search with the worker, Prisma and the site context faked at
 * their seams: no database, no worker, no selfie. Asserts what is written to BiometricConsent and
 * AuditLog, and that stale or unreviewed consent never reaches the worker.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  writes: [] as Array<{ model: string; op: string; data: Record<string, unknown> }>,
  child: null as null | { id: string; faceSearchOptOut: boolean },
  rawExecs: 0,
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
    $executeRaw: async () => {
      db.rawExecs++;
      return 1;
    },
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

const site = vi.hoisted(() => ({
  guest: null as null | { id: string; householdId: string; isChild: boolean; faceSearchOptOut: boolean },
}));
vi.mock("@/lib/site", () => ({
  requireViewer: async () => ({
    event: { id: "event-1", studioId: "studio-1", faceSearchEnabled: true },
    viewer: { principal: { userId: "user-1" }, guest: site.guest, can: () => true },
  }),
}));

const { POST } = await import("./route.ts");

const SELF = { subject: "me", consent: "on", consentVersion: "SEARCH_SELF:v1-2026-10", consentLocale: "en" };
const GUARDIAN = { subject: "guest-child", consent: "on", consentVersion: "SEARCH_GUARDIAN:v1-2026-10", consentLocale: "hi" };

function selfieRequest(fields: Record<string, string>) {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "selfie.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new NextRequest("http://priya-arjun.localhost/api/face/search", { method: "POST", body: fd });
}

const consents = () => db.writes.filter((w) => w.model === "biometricConsent").map((w) => w.data);
const audits = () => db.writes.filter((w) => w.model === "auditLog").map((w) => w.data);
let worker: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db.writes = [];
  db.rawExecs = 0;
  db.child = null;
  site.guest = { id: "guest-adult", householdId: "hh-1", isChild: false, faceSearchOptOut: false };
  const embedding = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
  worker = vi.fn(async () => Response.json({ ok: true, embedding, model: "test-model" }));
  vi.stubGlobal("fetch", worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/face/search consent records", () => {
  it("BiometricConsent.consentTextVersion for a self search equals SEARCH_SELF:v1-2026-10", async () => {
    const res = await POST(selfieRequest(SELF));
    expect(res.status).toBe(200);
    expect(consents()).toStrictEqual([expect.objectContaining({ kind: "SEARCH_SELF", consentTextVersion: "SEARCH_SELF:v1-2026-10" })]);
  });

  it("records the consent locale and version in the face.search audit row", async () => {
    await POST(selfieRequest({ ...SELF, consentLocale: "te" }));
    expect(audits()).toStrictEqual([
      expect.objectContaining({ action: "face.search", data: expect.objectContaining({ kind: "SEARCH_SELF", locale: "te", consentVersion: "SEARCH_SELF:v1-2026-10" }) }),
    ]);
  });

  it("a guardian search records the guardian text version", async () => {
    db.child = { id: "guest-child", faceSearchOptOut: false };
    const res = await POST(selfieRequest(GUARDIAN));
    expect(res.status).toBe(200);
    expect(consents()).toStrictEqual([
      expect.objectContaining({ kind: "SEARCH_GUARDIAN", subjectGuestId: "guest-child", consentTextVersion: "SEARCH_GUARDIAN:v1-2026-10" }),
    ]);
  });

  it("writes nothing without the consent box", async () => {
    const res = await POST(selfieRequest({ ...SELF, consent: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({ ok: false, reason: "consent_required" });
    expect(db.writes).toStrictEqual([]);
  });
});

describe("stale consent", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["an older version", { ...SELF, consentVersion: "SEARCH_SELF:v0-1999-01" }],
    ["no version at all", { subject: "me", consent: "on", consentLocale: "en" }],
    ["the self text for a child subject", { ...GUARDIAN, consentVersion: "SEARCH_SELF:v1-2026-10" }],
    ["no locale", { subject: "me", consent: "on", consentVersion: "SEARCH_SELF:v1-2026-10" }],
    ["an unknown locale", { ...SELF, consentLocale: "fr" }],
  ];
  for (const [what, fields] of cases) {
    it(`${what} -> 409 consent_stale, worker not called, nothing written`, async () => {
      db.child = { id: "guest-child", faceSearchOptOut: false };
      const res = await POST(selfieRequest(fields));
      expect(res.status).toBe(409);
      expect(await res.json()).toStrictEqual({ ok: false, reason: "consent_stale" });
      expect(worker).not.toHaveBeenCalled();
      expect(db.writes).toStrictEqual([]);
    });
  }
});

describe("face profile enrolment is off until revoke ships (WEB-006)", () => {
  it("remember=on on a self search writes no FACE_PROFILE consent and no profile", async () => {
    const res = await POST(selfieRequest({ ...SELF, remember: "on", profileConsentVersion: "FACE_PROFILE:v1-2026-10" }));
    expect(res.status).toBe(200);
    expect(consents().map((c) => c.kind)).toStrictEqual(["SEARCH_SELF"]);
    expect(db.rawExecs).toBe(0);
  });

  it("guardian search with remember=on writes no FACE_PROFILE consent", async () => {
    db.child = { id: "guest-child", faceSearchOptOut: false };
    await POST(selfieRequest({ ...GUARDIAN, remember: "on", profileConsentVersion: "FACE_PROFILE:v1-2026-10" }));
    expect(consents().map((c) => c.kind)).toStrictEqual(["SEARCH_GUARDIAN"]);
    expect(db.rawExecs).toBe(0);
  });

  it("a child viewer with remember=on writes no FACE_PROFILE consent", async () => {
    site.guest = { id: "guest-teen", householdId: "hh-1", isChild: true, faceSearchOptOut: false };
    await POST(selfieRequest({ ...SELF, remember: "on", profileConsentVersion: "FACE_PROFILE:v1-2026-10" }));
    expect(consents().map((c) => c.kind)).toStrictEqual(["SEARCH_SELF"]);
    expect(db.rawExecs).toBe(0);
  });
});

describe("production guard", () => {
  it("in production with unreviewed consent texts the route is disabled and the worker is not called", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(selfieRequest(SELF));
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({ ok: false, reason: "disabled" });
    expect(worker).not.toHaveBeenCalled();
    expect(db.writes).toStrictEqual([]);
  });
});
