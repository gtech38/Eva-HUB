/**
 * Self-contained auth for the POC: signed session cookie → Session row.
 * Magic links and invitation links are hashed tokens in the DB.
 *
 * This is small enough to own; swap for Better Auth later if passkeys are wanted.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, type AuthMethod, type ContactKind } from "@hub/db";
import { env } from "./env.ts";
import type { Principal } from "./policy.ts";

export const SESSION_COOKIE = "hub_session";

// ── tokens ──

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function newOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── cookie signing ──

function sign(value: string) {
  return createHmac("sha256", env().AUTH_SECRET).update(value).digest("base64url");
}
export function encodeCookie(sessionId: string) {
  return `${sessionId}.${sign(sessionId)}`;
}
export function decodeCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const id = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expect = sign(id);
  if (sig.length !== expect.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expect)) ? id : null;
}

// ── sessions ──

/**
 * When a session minted at `now` expires. INVITE_LINK sessions get `inviteDays` but never
 * outlive the invitation token they were opened with (docs/02 §2 rule 3).
 */
export function sessionExpiry(
  authMethod: AuthMethod,
  now: Date,
  ttl: { sessionDays: number; inviteDays: number },
  inviteExpiresAt?: Date,
): Date {
  if (authMethod !== "INVITE_LINK") return new Date(now.getTime() + ttl.sessionDays * 864e5);
  const byTtl = now.getTime() + ttl.inviteDays * 864e5;
  return new Date(inviteExpiresAt ? Math.min(byTtl, inviteExpiresAt.getTime()) : byTtl);
}

/** `inviteExpiresAt`: the invitation token's expiry, which caps an INVITE_LINK session. */
export async function createSession(userId: string, authMethod: AuthMethod, guestScopeEventId?: string, inviteExpiresAt?: Date) {
  const e = env();
  const expiresAt = sessionExpiry(authMethod, new Date(), { sessionDays: e.SESSION_TTL_DAYS, inviteDays: e.INVITE_SESSION_TTL_DAYS }, inviteExpiresAt);
  const s = await prisma.session.create({
    data: { userId, authMethod, guestScopeEventId, expiresAt },
  });
  return { session: s, cookie: encodeCookie(s.id) };
}

export async function destroySession(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Normalise an identifier a person typed: lower-case email or E.164-ish phone. */
export function normalizeContact(raw: string): { kind: ContactKind; value: string } | null {
  const v = raw.trim();
  if (v.includes("@")) return { kind: "EMAIL", value: v.toLowerCase() };
  const digits = v.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length >= 10) {
    const e164 = digits.startsWith("+") ? digits : `+1${digits.replace(/\D/g, "").slice(-10)}`;
    return { kind: "PHONE", value: e164 };
  }
  return null;
}

/** Load the Principal for a session cookie, or null. */
export async function principalFromCookie(raw: string | undefined | null): Promise<(Principal & { sessionId: string; displayName: string | null; guestScopeEventId: string | null }) | null> {
  const id = decodeCookie(raw);
  if (!id) return null;
  const s = await prisma.session.findUnique({
    where: { id },
    include: {
      user: {
        include: { studioMembers: true, eventMembers: true, guests: { where: { deletedAt: null }, select: { eventId: true } } },
      },
    },
  });
  if (!s || s.expiresAt < new Date() || s.user.deletedAt || s.user.status === "DISABLED") return null;
  const u = s.user;
  const eventRoles: Principal["eventRoles"] = {};
  for (const m of u.eventMembers) (eventRoles[m.eventId] ??= []).push(m.role);
  return {
    sessionId: s.id,
    userId: u.id,
    displayName: u.displayName,
    isPlatformAdmin: u.isPlatformAdmin,
    studioRoles: Object.fromEntries(u.studioMembers.map((m) => [m.studioId, m.role])),
    eventRoles,
    guestOf: new Set(u.guests.map((g) => g.eventId)),
    authMethod: s.authMethod,
    authedAt: s.authedAt,
    guestScopeEventId: s.guestScopeEventId,
  };
}

/**
 * Resolve-or-create a user for a *verified* contact. This is the only place a
 * Guest row gets linked to a User (docs/02-users-and-roles.md §2 rule 2).
 */
export async function resolveUserForVerifiedContact(kind: ContactKind, value: string, displayName?: string | null) {
  const cp = await prisma.contactPoint.findUnique({ where: { kind_value: { kind, value } } });
  if (cp) {
    if (!cp.verifiedAt) await prisma.contactPoint.update({ where: { id: cp.id }, data: { verifiedAt: new Date() } });
    return prisma.user.findUniqueOrThrow({ where: { id: cp.userId } });
  }
  return prisma.user.create({
    data: { displayName: displayName ?? null, status: "UNCLAIMED", contactPoints: { create: { kind, value, verifiedAt: new Date(), isPrimary: true } } },
  });
}

/** Link any unlinked Guest rows whose host-typed contact matches a now-verified contact. */
export async function linkGuestsForContact(userId: string, kind: ContactKind, value: string) {
  const where = kind === "EMAIL" ? { email: value } : { phone: value };
  const guests = await prisma.guest.findMany({ where: { ...where, userId: null, deletedAt: null } });
  for (const g of guests) {
    // one guest row per (event, user): skip if the user already has one in this event
    const clash = await prisma.guest.findUnique({ where: { eventId_userId: { eventId: g.eventId, userId } } });
    if (!clash) await prisma.guest.update({ where: { id: g.id }, data: { userId } });
  }
  return guests.length;
}
