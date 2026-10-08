"use server";

import { z } from "zod";
import { EventKindSchema, ThemeKeySchema } from "@/lib/eventSchemas";
import { revalidatePath } from "next/cache";
import { prisma, enqueue } from "@hub/db";
import { env, PAGE_SCHEMAS, type PageType } from "@hub/shared";
import { act, EmailSchema, str, opt, bool, localized, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { userForEmail } from "@/lib/users";

async function loadEvent(studioId: string, eventId: string) {
  const e = await prisma.event.findFirst({ where: { id: eventId, studioId } });
  if (!e) throw new Error("Event not found");
  return e;
}

const base = (studioId: string, eventId: string) => `/studios/${studioId}/events/${eventId}`;

// ───────────── Settings ─────────────

const Retention = z.coerce.number().int().min(30, "Minimum 30 days").max(730, "Maximum 730 days");
const EventSettings = z.object({
  title: z.object({ en: z.string().min(1, "English title is required"), te: z.string().optional(), hi: z.string().optional() }),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes only"),
  startsOn: z.string().optional(),
  timezone: z.string().min(1, "Timezone is required"),
  status: z.enum(["DRAFT", "LIVE", "COMPLETED", "ARCHIVED"]),
  theme: ThemeKeySchema,
  kind: EventKindSchema,
  monogram: z.string().max(12).optional(),
  enabledLocales: z.array(z.enum(["en", "te", "hi"])).min(1, "Enable at least one locale"),
  defaultLocale: z.enum(["en", "te", "hi"]),
  faceSearchEnabled: z.boolean(),
  faceIndexRetentionDays: Retention.nullable(),
});

export async function updateEventSettings(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.settings", { studioId, eventId });
    const before = await loadEvent(studioId, eventId);
    const locales = fd.getAll("enabledLocales").map(String);
    const retentionRaw = str(fd, "faceIndexRetentionDays");
    const input = EventSettings.parse({
      title: localized(fd, "title"), slug: str(fd, "slug"), startsOn: str(fd, "startsOn") || undefined, timezone: str(fd, "timezone"),
      status: str(fd, "status"), theme: str(fd, "theme"), kind: str(fd, "kind") || before.kind, monogram: str(fd, "monogram") || undefined,
      enabledLocales: locales, defaultLocale: str(fd, "defaultLocale"), faceSearchEnabled: bool(fd, "faceSearchEnabled"),
      faceIndexRetentionDays: retentionRaw === "" ? null : retentionRaw,
    });
    if (!input.enabledLocales.includes(input.defaultLocale)) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { defaultLocale: ["Default locale must be one of the enabled locales"] } };

    const rootDomain = env().ROOT_DOMAIN;
    if (input.slug !== before.slug) {
      const clash = await prisma.event.findUnique({ where: { studioId_slug: { studioId, slug: input.slug } } });
      const dclash = await prisma.domain.findUnique({ where: { hostname: `${input.slug}.${rootDomain}` } });
      if (clash || (dclash && dclash.eventId !== eventId)) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { slug: ["Slug already in use"] } };
    }

    const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId } });
    const effectiveRetention = input.faceIndexRetentionDays ?? studio.faceIndexRetentionDays;
    const galleryPublishedAt = before.galleryPublishedAt ?? (input.status === "LIVE" ? new Date() : null);
    const faceIndexPurgeAt = galleryPublishedAt && !before.faceIndexPurgedAt ? new Date(galleryPublishedAt.getTime() + effectiveRetention * 864e5) : before.faceIndexPurgeAt;

    await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          title: input.title, slug: input.slug, startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00`) : null, timezone: input.timezone,
          status: input.status, theme: input.theme, kind: input.kind,
          themeOverrides: { ...((before.themeOverrides as object) ?? {}), monogram: input.monogram ?? null },
          enabledLocales: input.enabledLocales, defaultLocale: input.defaultLocale,
          faceSearchEnabled: input.faceSearchEnabled, faceIndexRetentionDays: input.faceIndexRetentionDays,
          galleryPublishedAt, faceIndexPurgeAt,
        },
      });
      if (input.slug !== before.slug) {
        const oldHost = `${before.slug}.${rootDomain}`;
        const newHost = `${input.slug}.${rootDomain}`;
        const existing = await tx.domain.findFirst({ where: { eventId, hostname: oldHost } }) ?? await tx.domain.findFirst({ where: { eventId, isPrimary: true } });
        if (existing) await tx.domain.update({ where: { id: existing.id }, data: { hostname: newHost } });
        else await tx.domain.create({ data: { hostname: newHost, studioId, eventId, isPrimary: true, verifiedAt: new Date() } });
      }
    });

    if (before.faceIndexRetentionDays !== input.faceIndexRetentionDays) {
      await audit({ studioId, eventId, actorUserId: p.userId, action: "event.retention.change", target: eventId, data: { from: before.faceIndexRetentionDays, to: input.faceIndexRetentionDays, effective: effectiveRetention } });
    }
    if (before.faceSearchEnabled !== input.faceSearchEnabled) {
      await audit({ studioId, eventId, actorUserId: p.userId, action: input.faceSearchEnabled ? "event.facesearch.enable" : "event.facesearch.disable", target: eventId });
    }
    await audit({ studioId, eventId, actorUserId: p.userId, action: "event.settings.update", target: eventId, data: { slugChanged: before.slug !== input.slug, status: input.status, ...(before.theme !== input.theme ? { theme: { from: before.theme, to: input.theme } } : {}), ...(before.kind !== input.kind ? { kind: { from: before.kind, to: input.kind } } : {}) } });
    revalidatePath(`/studios/${studioId}`, "layout");
    return { ok: true, message: "Settings saved." };
  });
}

export async function purgeFaceIndexNow(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.settings", { studioId, eventId });
    await loadEvent(studioId, eventId);
    await enqueue("PURGE_FACE_INDEX", { eventId }, { dedupeKey: `purge-face:${eventId}:${Date.now()}` });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "faceindex.purge.request", target: eventId });
    revalidatePath(base(studioId, eventId), "layout");
    return { ok: true, message: "Purge job queued. Faces and clusters are deleted by the worker; saved photo matches survive." };
  });
}

// ───────────── Members ─────────────

const ROLES = ["HOST", "COHOST", "PLANNER", "VENDOR", "STAFF"] as const;
const AddMember = z.object({ email: EmailSchema("Enter a valid email"), role: z.enum(ROLES), displayName: z.string().optional(), vendorCategory: z.string().optional() });

export async function addMember(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.members.manage", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const input = AddMember.parse({ email: str(fd, "email"), role: str(fd, "role"), displayName: str(fd, "displayName") || undefined, vendorCategory: str(fd, "vendorCategory") || undefined });
    if (input.role === "STAFF") {
      // Staff assignment only makes sense for studio staff; owners already see everything.
      const u = await userForEmail(input.email, input.displayName);
      const sm = await prisma.studioMember.findUnique({ where: { studioId_userId: { studioId, userId: u.id } } });
      if (!sm) return { ok: false, error: "STAFF assignment requires the person to be a studio member first (Studio → Staff)." };
    }
    const user = await userForEmail(input.email, input.displayName);
    await prisma.eventMember.upsert({
      where: { eventId_userId_role: { eventId, userId: user.id, role: input.role } },
      create: { eventId, userId: user.id, role: input.role, vendorCategory: input.role === "VENDOR" ? input.vendorCategory ?? null : null },
      update: { vendorCategory: input.role === "VENDOR" ? input.vendorCategory ?? null : null },
    });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "event.member.add", target: user.id, data: { role: input.role, email: input.email } });
    revalidatePath(`${base(studioId, eventId)}/members`);
    return { ok: true, message: `${input.email} added as ${input.role}.` };
  });
}

export async function removeMember(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.members.manage", { studioId, eventId });
    const m = await prisma.eventMember.findFirst({ where: { id: str(fd, "memberId"), eventId, event: { studioId } } });
    if (!m) return { ok: false, error: "Member not found" };
    await prisma.eventMember.delete({ where: { id: m.id } });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "event.member.remove", target: m.userId, data: { role: m.role } });
    revalidatePath(`${base(studioId, eventId)}/members`);
    return { ok: true };
  });
}

// ───────────── Pages ─────────────

const LOCALES = ["en", "te", "hi"] as const;

/** Rebuild a page's content object from the flat form, validate with the page's Zod schema. */
export async function savePage(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.content.edit", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const type = str(fd, "type") as PageType;
    const schema = PAGE_SCHEMAS[type];
    if (!schema) return { ok: false, error: "Unknown page type" };

    const content: Record<string, unknown> = {};
    const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    for (const [key, def] of Object.entries(shape)) {
      const inner = unwrap(def);
      if (inner instanceof z.ZodArray) {
        const raw = str(fd, `f.${key}`);
        if (raw === "") { content[key] = []; continue; }
        try { content[key] = JSON.parse(raw); } catch { return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { [key]: ["Invalid JSON"] } }; }
      } else if (inner instanceof z.ZodRecord) {
        const o: Record<string, string> = {};
        for (const l of LOCALES) { const v = str(fd, `f.${key}.${l}`); if (v) o[l] = v; }
        content[key] = o;
      } else {
        const v = str(fd, `f.${key}`);
        content[key] = v === "" ? (inner instanceof z.ZodString && !def.isNullable() ? undefined : null) : v;
        if (content[key] === undefined) delete content[key];
      }
    }
    const parsed = schema.safeParse(content);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) { const k = String(i.path[0] ?? "_"); (fieldErrors[k] ??= []).push(`${i.path.slice(1).join(".") ? i.path.slice(1).join(".") + ": " : ""}${i.message}`); }
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    const sortOrder = parseInt(str(fd, "sortOrder") || "0", 10) || 0;
    await prisma.eventPage.upsert({
      where: { eventId_type: { eventId, type } },
      create: { eventId, type, enabled: bool(fd, "enabled"), sortOrder, content: parsed.data as object },
      update: { enabled: bool(fd, "enabled"), sortOrder, content: parsed.data as object },
    });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "event.page.update", target: type });
    revalidatePath(`${base(studioId, eventId)}/pages`);
    return { ok: true, message: `${type} saved.` };
  });
}

function unwrap(def: z.ZodTypeAny): z.ZodTypeAny {
  let d = def;
  for (let i = 0; i < 5; i++) {
    if (d instanceof z.ZodDefault) d = d._def.innerType;
    else if (d instanceof z.ZodOptional || d instanceof z.ZodNullable) d = d._def.innerType;
    else break;
  }
  return d;
}

// ───────────── Schedule ─────────────

const SubEventInput = z.object({
  name: z.object({ en: z.string().min(1, "English name is required"), te: z.string().optional(), hi: z.string().optional() }),
  startsAt: z.string().min(1, "Start time is required"),
  endsAt: z.string().optional(),
  venueName: z.string().optional(), venueAddress: z.string().optional(),
  mapUrl: z.string().url("Enter a full URL").or(z.literal("")).optional(),
  dressCode: z.string().optional(),
  servesMeal: z.boolean(),
  rsvpDeadline: z.string().optional(),
  sortOrder: z.coerce.number().int().default(0),
});

export async function saveSubEvent(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.content.edit", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const id = opt(fd, "subEventId");
    const input = SubEventInput.parse({ name: localized(fd, "name"), startsAt: str(fd, "startsAt"), endsAt: str(fd, "endsAt") || undefined, venueName: str(fd, "venueName") || undefined, venueAddress: str(fd, "venueAddress") || undefined, mapUrl: str(fd, "mapUrl"), dressCode: str(fd, "dressCode") || undefined, servesMeal: bool(fd, "servesMeal"), rsvpDeadline: str(fd, "rsvpDeadline") || undefined, sortOrder: str(fd, "sortOrder") || 0 });
    const data = {
      name: input.name, startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null,
      venueName: input.venueName ?? null, venueAddress: input.venueAddress ?? null, mapUrl: input.mapUrl || null,
      dressCode: input.dressCode ? { en: input.dressCode } : undefined, servesMeal: input.servesMeal,
      rsvpDeadline: input.rsvpDeadline ? new Date(input.rsvpDeadline) : null, sortOrder: input.sortOrder,
    };
    if (id) {
      const ex = await prisma.subEvent.findFirst({ where: { id, eventId } });
      if (!ex) return { ok: false, error: "Sub-event not found" };
      await prisma.subEvent.update({ where: { id }, data: { ...data, dressCode: input.dressCode ? { en: input.dressCode } : (ex.dressCode === null ? undefined : { en: "" }) } });
    } else {
      await prisma.subEvent.create({ data: { eventId, ...data } });
    }
    revalidatePath(`${base(studioId, eventId)}/schedule`);
    return { ok: true, message: "Saved." };
  });
}

export async function deleteSubEvent(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.content.edit", { studioId, eventId });
    const id = str(fd, "subEventId");
    const ex = await prisma.subEvent.findFirst({ where: { id, eventId, event: { studioId } } });
    if (!ex) return { ok: false, error: "Sub-event not found" };
    const answered = await prisma.rsvp.count({ where: { subEventId: id, status: { not: "PENDING" } } });
    if (answered > 0) return { ok: false, error: `${answered} guests already answered for this sub-event. Remove their RSVPs first.` };
    await prisma.$transaction([
      prisma.rsvp.deleteMany({ where: { subEventId: id } }),
      prisma.subEventInvite.deleteMany({ where: { subEventId: id } }),
      prisma.mealOption.deleteMany({ where: { subEventId: id } }),
      prisma.album.updateMany({ where: { subEventId: id }, data: { subEventId: null } }),
      prisma.subEvent.delete({ where: { id } }),
    ]);
    revalidatePath(`${base(studioId, eventId)}/schedule`);
    return { ok: true };
  });
}

export async function addMealOption(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.content.edit", { studioId, eventId });
    const subEventId = str(fd, "subEventId");
    const se = await prisma.subEvent.findFirst({ where: { id: subEventId, eventId, event: { studioId } } });
    if (!se) return { ok: false, error: "Sub-event not found" };
    const label = str(fd, "label");
    if (!label) return { ok: false, error: "Label is required", fieldErrors: { label: ["Required"] } };
    const count = await prisma.mealOption.count({ where: { subEventId } });
    await prisma.mealOption.create({ data: { subEventId, label: { en: label }, isKidsMeal: bool(fd, "isKidsMeal"), sortOrder: count } });
    revalidatePath(`${base(studioId, eventId)}/schedule`);
    return { ok: true };
  });
}

export async function deleteMealOption(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "event.content.edit", { studioId, eventId });
    const id = str(fd, "mealOptionId");
    const mo = await prisma.mealOption.findFirst({ where: { id, subEvent: { eventId, event: { studioId } } } });
    if (!mo) return { ok: false, error: "Not found" };
    const used = await prisma.rsvp.count({ where: { mealOptionId: id } });
    if (used > 0) return { ok: false, error: `${used} guests chose this meal; can't delete.` };
    await prisma.mealOption.delete({ where: { id } });
    revalidatePath(`${base(studioId, eventId)}/schedule`);
    return { ok: true };
  });
}

// ───────────── Registry ─────────────

const RegistryItemInput = z.object({ title: z.string().min(1, "Title is required"), storeName: z.string().optional(), url: z.string().url("Enter a full URL"), imageUrl: z.string().url("Enter a full URL").or(z.literal("")).optional(), quantity: z.coerce.number().int().min(1, "At least 1") });

export async function saveRegistryItem(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "registry.manage", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const id = opt(fd, "itemId");
    const input = RegistryItemInput.parse({ title: str(fd, "title"), storeName: str(fd, "storeName") || undefined, url: str(fd, "url"), imageUrl: str(fd, "imageUrl"), quantity: str(fd, "quantity") || 1 });
    const data = { title: { en: input.title }, storeName: input.storeName ?? null, url: input.url, imageUrl: input.imageUrl || null, quantity: input.quantity };
    if (id) {
      const ex = await prisma.registryItem.findFirst({ where: { id, eventId } });
      if (!ex) return { ok: false, error: "Item not found" };
      await prisma.registryItem.update({ where: { id }, data });
    } else {
      const count = await prisma.registryItem.count({ where: { eventId } });
      await prisma.registryItem.create({ data: { eventId, ...data, sortOrder: count } });
    }
    revalidatePath(`${base(studioId, eventId)}/registry`);
    return { ok: true, message: "Saved." };
  });
}

export async function deleteRegistryItem(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "registry.manage", { studioId, eventId });
    const id = str(fd, "itemId");
    const ex = await prisma.registryItem.findFirst({ where: { id, eventId, event: { studioId } } });
    if (!ex) return { ok: false, error: "Item not found" };
    await prisma.$transaction([prisma.registryClaim.deleteMany({ where: { itemId: id } }), prisma.registryItem.delete({ where: { id } })]);
    revalidatePath(`${base(studioId, eventId)}/registry`);
    return { ok: true };
  });
}

const CashFundInput = z.object({ title: z.string().min(1, "Title is required"), kind: z.enum(["STRIPE", "EXTERNAL"]), externalHandle: z.string().optional(), goalCents: z.coerce.number().int().min(0).nullable() });

export async function saveCashFund(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "registry.manage", { studioId, eventId });
    await loadEvent(studioId, eventId);
    const id = opt(fd, "fundId");
    const goal = str(fd, "goal");
    const input = CashFundInput.parse({ title: str(fd, "title"), kind: str(fd, "kind"), externalHandle: str(fd, "externalHandle") || undefined, goalCents: goal === "" ? null : Math.round(parseFloat(goal) * 100) });
    if (input.kind === "EXTERNAL" && !input.externalHandle) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { externalHandle: ["Venmo/Zelle handle is required for external funds"] } };
    const data = { title: { en: input.title }, kind: input.kind, externalHandle: input.kind === "EXTERNAL" ? input.externalHandle ?? null : null, goalCents: input.goalCents };
    if (id) {
      const ex = await prisma.cashFund.findFirst({ where: { id, eventId } });
      if (!ex) return { ok: false, error: "Fund not found" };
      await prisma.cashFund.update({ where: { id }, data });
    } else {
      await prisma.cashFund.create({ data: { eventId, ...data } });
    }
    revalidatePath(`${base(studioId, eventId)}/registry`);
    return { ok: true, message: "Saved." };
  });
}

export async function deleteCashFund(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const p = await requireSignedIn();
    const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
    authorize(p, "registry.manage", { studioId, eventId });
    const id = str(fd, "fundId");
    const ex = await prisma.cashFund.findFirst({ where: { id, eventId, event: { studioId } } });
    if (!ex) return { ok: false, error: "Fund not found" };
    const contributions = await prisma.contribution.count({ where: { cashFundId: id } });
    if (contributions > 0) return { ok: false, error: "This fund has contributions and can't be deleted." };
    await prisma.cashFund.delete({ where: { id } });
    revalidatePath(`${base(studioId, eventId)}/registry`);
    return { ok: true };
  });
}
