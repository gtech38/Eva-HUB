"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@hub/db";
import { env, parsePage, type PageType } from "@hub/shared";
import { act, EmailSchema, str, opt, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { userForEmail } from "@/lib/users";
import { PAGE_ORDER } from "@/lib/data";

const Retention = z.coerce.number().int().min(30, "Minimum 30 days").max(730, "Maximum 730 days");

const StudioSettings = z.object({
  name: z.string().min(2, "Name is required"),
  credit: z.string().min(1, "Credit text is required"),
  url: z.string().url("Enter a full URL (https://…)").or(z.literal("")),
  logoText: z.string().max(6, "Max 6 characters"),
  faceIndexRetentionDays: Retention,
});

export async function updateStudioSettings(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId");
    authorize(p, "studio.manage", { studioId });
    const input = StudioSettings.parse({ name: str(fd, "name"), credit: str(fd, "credit"), url: str(fd, "url"), logoText: str(fd, "logoText"), faceIndexRetentionDays: str(fd, "faceIndexRetentionDays") });
    const before = await prisma.studio.findUniqueOrThrow({ where: { id: studioId } });
    await prisma.studio.update({
      where: { id: studioId },
      data: { name: input.name, brandJson: { ...(before.brandJson as object ?? {}), credit: input.credit, url: input.url, logoText: input.logoText }, faceIndexRetentionDays: input.faceIndexRetentionDays },
    });
    if (before.faceIndexRetentionDays !== input.faceIndexRetentionDays) {
      await audit({ studioId, actorUserId: p.userId, action: "studio.retention.change", target: studioId, data: { from: before.faceIndexRetentionDays, to: input.faceIndexRetentionDays } });
      // Recompute purge dates for events that inherit the studio default.
      const events = await prisma.event.findMany({ where: { studioId, faceIndexRetentionDays: null, galleryPublishedAt: { not: null }, faceIndexPurgedAt: null } });
      for (const e of events) {
        await prisma.event.update({ where: { id: e.id }, data: { faceIndexPurgeAt: new Date(e.galleryPublishedAt!.getTime() + input.faceIndexRetentionDays * 864e5) } });
      }
    }
    await audit({ studioId, actorUserId: p.userId, action: "studio.settings.update", target: studioId });
    revalidatePath(`/studios/${studioId}`, "layout");
    return { ok: true, message: "Settings saved." };
  });
}

const AddStaff = z.object({ email: EmailSchema(), role: z.enum(["OWNER", "STAFF"]), displayName: z.string().optional() });

export async function addStaff(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId");
    authorize(p, "studio.manage", { studioId });
    const input = AddStaff.parse({ email: str(fd, "email"), role: str(fd, "role"), displayName: str(fd, "displayName") || undefined });
    const user = await userForEmail(input.email, input.displayName);
    await prisma.studioMember.upsert({
      where: { studioId_userId: { studioId, userId: user.id } },
      create: { studioId, userId: user.id, role: input.role },
      update: { role: input.role },
    });
    await audit({ studioId, actorUserId: p.userId, action: "studio.member.add", target: user.id, data: { role: input.role, email: input.email } });
    revalidatePath(`/studios/${studioId}/staff`);
    return { ok: true, message: `${input.email} added as ${input.role}.` };
  });
}

export async function removeStaff(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId");
    const memberId = str(fd, "memberId");
    authorize(p, "studio.manage", { studioId });
    const m = await prisma.studioMember.findFirst({ where: { id: memberId, studioId } });
    if (!m) return { ok: false, error: "Member not found" };
    if (m.userId === p.userId) return { ok: false, error: "You can't remove yourself." };
    const owners = await prisma.studioMember.count({ where: { studioId, role: "OWNER" } });
    if (m.role === "OWNER" && owners <= 1) return { ok: false, error: "A studio needs at least one owner." };
    await prisma.studioMember.delete({ where: { id: memberId } });
    await audit({ studioId, actorUserId: p.userId, action: "studio.member.remove", target: m.userId, data: { role: m.role } });
    revalidatePath(`/studios/${studioId}/staff`);
    return { ok: true };
  });
}

// ── Price sheets ──

const ProductInput = z.object({
  name: z.string().min(1, "Name is required"),
  kind: z.enum(["GALLERY_UNLOCK", "DIGITAL_PHOTO", "PRINT"]),
  priceCents: z.coerce.number().int().min(0, "Price can't be negative"),
  labSku: z.string().optional(),
  active: z.boolean(),
});

export async function saveProduct(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId");
    authorize(p, "studio.manage", { studioId });
    const productId = opt(fd, "productId");
    const dollars = str(fd, "price");
    const input = ProductInput.parse({ name: str(fd, "name"), kind: str(fd, "kind"), priceCents: Math.round(parseFloat(dollars || "0") * 100), labSku: str(fd, "labSku") || undefined, active: fd.get("active") !== null });
    let sheet = await prisma.priceSheet.findFirst({ where: { studioId } });
    sheet ??= await prisma.priceSheet.create({ data: { studioId, name: "Default" } });
    if (productId) {
      const existing = await prisma.product.findFirst({ where: { id: productId, priceSheet: { studioId } } });
      if (!existing) return { ok: false, error: "Product not found" };
      await prisma.product.update({ where: { id: productId }, data: { name: input.name, kind: input.kind, priceCents: input.priceCents, labSku: input.labSku ?? null, active: input.active } });
    } else {
      await prisma.product.create({ data: { priceSheetId: sheet.id, name: input.name, kind: input.kind, priceCents: input.priceCents, labSku: input.labSku ?? null, active: input.active } });
    }
    revalidatePath(`/studios/${studioId}/pricing`);
    return { ok: true, message: "Saved." };
  });
}

export async function deleteProduct(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId");
    authorize(p, "studio.manage", { studioId });
    const productId = str(fd, "productId");
    const existing = await prisma.product.findFirst({ where: { id: productId, priceSheet: { studioId } } });
    if (!existing) return { ok: false, error: "Product not found" };
    const used = await prisma.orderItem.count({ where: { productId } });
    if (used > 0) {
      await prisma.product.update({ where: { id: productId }, data: { active: false } });
      return { ok: true, message: "Product has orders; deactivated instead of deleted." };
    }
    await prisma.product.delete({ where: { id: productId } });
    revalidatePath(`/studios/${studioId}/pricing`);
    return { ok: true };
  });
}

// ── Create event ──

const CreateEvent = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(2, "Slug is required").max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes only"),
  theme: z.enum(["LUXURY", "ROMANTIC", "HINDU_TRADITIONAL", "NURSERY_SAGE", "TELUGU_TRADITIONAL", "MIDNIGHT_GALA"]),
  kind: z.enum(["WEDDING", "ENGAGEMENT", "BABY_SHOWER", "BIRTHDAY", "ANNIVERSARY", "CEREMONY", "PARTY", "CORPORATE", "OTHER"]).default("WEDDING"),
  startsOn: z.string().optional(),
  timezone: z.string().min(1),
  hostEmail: EmailSchema("Enter a valid email").or(z.literal("")),
  hostUserId: z.string().optional(),
});

const RESERVED_SLUGS = new Set(["app", "www", "admin", "api", "mail", "cdn", "static"]);

export async function createEvent(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId");
    authorize(p, "event.create", { studioId });
    const input = CreateEvent.parse({ title: str(fd, "title"), slug: str(fd, "slug"), theme: str(fd, "theme"), kind: str(fd, "kind") || "WEDDING", startsOn: str(fd, "startsOn") || undefined, timezone: str(fd, "timezone") || "America/Chicago", hostEmail: str(fd, "hostEmail"), hostUserId: str(fd, "hostUserId") || undefined });

    if (RESERVED_SLUGS.has(input.slug)) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { slug: ["That slug is reserved"] } };
    const hostname = `${input.slug}.${env().ROOT_DOMAIN}`;
    if (await prisma.event.findUnique({ where: { studioId_slug: { studioId, slug: input.slug } } }) || await prisma.domain.findUnique({ where: { hostname } })) {
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { slug: ["Slug / hostname already in use"] } };
    }

    let hostUserId: string | null = null;
    if (input.hostUserId) {
      // Must be a studio contact (guest or member in one of this studio's events) or a studio member.
      const u = await prisma.user.findFirst({ where: { id: input.hostUserId, OR: [{ guests: { some: { studioId } } }, { eventMembers: { some: { event: { studioId } } } }, { studioMembers: { some: { studioId } } }] } });
      if (!u) return { ok: false, error: "Selected host is not a contact of this studio." };
      hostUserId = u.id;
    } else if (input.hostEmail) {
      hostUserId = (await userForEmail(input.hostEmail)).id;
    }

    const event = await prisma.$transaction(async (tx) => {
      const ev = await tx.event.create({
        data: {
          studioId,
          slug: input.slug,
          title: { en: input.title },
          theme: input.theme,
          kind: input.kind,
          startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00`) : null,
          timezone: input.timezone,
          status: "DRAFT",
          themeOverrides: { monogram: input.title.split(/\s*(?:&|and)\s*/i).map((s) => s.trim()[0]?.toUpperCase() ?? "").filter(Boolean).join("&") || null },
        },
      });
      await tx.domain.create({ data: { hostname, studioId, eventId: ev.id, isPrimary: true, verifiedAt: new Date() } });
      const defaults: PageType[] = ["HOME", "ABOUT", "SCHEDULE", "TRAVEL", "FAQ", "GALLERY", "RSVP"];
      for (const type of PAGE_ORDER) {
        if (!defaults.includes(type)) continue;
        await tx.eventPage.create({ data: { eventId: ev.id, type, sortOrder: PAGE_ORDER.indexOf(type), content: parsePage(type, {}) as object } });
      }
      await tx.album.create({ data: { studioId, eventId: ev.id, title: { en: "Highlights" }, visibility: "GUESTS", sortOrder: 0 } });
      if (hostUserId) await tx.eventMember.create({ data: { eventId: ev.id, userId: hostUserId, role: "HOST" } });
      return ev;
    });

    await audit({ studioId, eventId: event.id, actorUserId: p.userId, action: "event.create", target: event.id, data: { slug: input.slug, theme: input.theme, hostUserId } });
    revalidatePath(`/studios/${studioId}`, "layout");
    return { ok: true, message: "Event created.", data: { eventId: event.id } };
  });
}

/** Contact search for the "add existing user as host" picker. */
export async function searchStudioContacts(studioId: string, q: string) {
  const p = await requireSignedIn();
  authorize(p, "studio.view", { studioId });
  if (q.trim().length < 2) return [];
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [{ guests: { some: { studioId } } }, { eventMembers: { some: { event: { studioId } } } }, { studioMembers: { some: { studioId } } }],
      AND: { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { contactPoints: { some: { value: { contains: q, mode: "insensitive" } } } }, { guests: { some: { studioId, OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } }] },
    },
    take: 8,
    select: { id: true, displayName: true, contactPoints: { select: { kind: true, value: true } }, guests: { where: { studioId }, select: { firstName: true, lastName: true }, take: 1 } },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.displayName || [u.guests[0]?.firstName, u.guests[0]?.lastName].filter(Boolean).join(" ") || "Unnamed",
    contact: u.contactPoints.find((c) => c.kind === "EMAIL")?.value ?? u.contactPoints[0]?.value ?? "",
  }));
}
