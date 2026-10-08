import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { SESSION_COOKIE, principalFromCookie, can, type Action, type Principal, type Resource } from "@hub/shared";

export type AdminPrincipal = NonNullable<Awaited<ReturnType<typeof principalFromCookie>>>;

/** Principal for the current request (memoised per request). */
export const getPrincipal = cache(async (): Promise<AdminPrincipal | null> => {
  const jar = await cookies();
  return principalFromCookie(jar.get(SESSION_COOKIE)?.value);
});

export class ForbiddenError extends Error {
  constructor(action: string) {
    super(`Forbidden: ${action}`);
    this.name = "ForbiddenError";
  }
}

/** True when `can()` fails only because the 12h re-auth gate tripped. */
export function isStale(p: Principal, action: Action, r: Resource) {
  return !can(p, action, r) && can({ ...p, authedAt: new Date() }, action, r);
}

/**
 * Permission check for mutations. Never trust the UI: every server action calls this.
 * A stale session is sent back to sign in; an actual denial throws.
 */
export function authorize(p: Principal, action: Action, r: Resource) {
  if (can(p, action, r)) return;
  if (isStale(p, action, r)) redirect("/login?reauth=1");
  throw new ForbiddenError(action);
}

/** Signed-in principal or redirect to /login. */
export async function requireSignedIn(): Promise<AdminPrincipal> {
  const p = await getPrincipal();
  if (!p) redirect("/login");
  if (p.authMethod === "INVITE_LINK") redirect("/login?reauth=1");
  return p;
}

/** Admin for a studio: signed in and allowed `studio.view` there. */
export async function requireAdmin(studioId?: string): Promise<AdminPrincipal> {
  const p = await requireSignedIn();
  if (studioId) {
    if (!can(p, "studio.view", { studioId })) {
      if (isStale(p, "studio.view", { studioId })) redirect("/login?reauth=1");
      notFound();
    }
  } else if (!p.isPlatformAdmin && Object.keys(p.studioRoles).length === 0) {
    redirect("/login?denied=1");
  }
  return p;
}

export async function requirePlatformAdmin(): Promise<AdminPrincipal> {
  const p = await requireSignedIn();
  if (!can(p, "platform.admin", { studioId: "" })) {
    if (isStale(p, "platform.admin", { studioId: "" })) redirect("/login?reauth=1");
    notFound();
  }
  return p;
}

/** Studios the principal can see, for the sidebar switcher. */
export async function visibleStudios(p: AdminPrincipal) {
  if (p.isPlatformAdmin) return prisma.studio.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
  const ids = Object.keys(p.studioRoles);
  if (ids.length === 0) return [];
  return prisma.studio.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
}
