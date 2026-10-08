"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@hub/db";
import { normalizeContact } from "@hub/shared";
import { act, EmailSchema, str, opt, bool, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { csvRecords } from "@/lib/csv";
import { lt } from "@/lib/format";
import { syncInvites } from "@/lib/guests";

const base = (studioId: string, eventId: string) => `/studios/${studioId}/events/${eventId}/guests`;

async function guard(fd: FormData) {
  const p = await requireSignedIn();
  const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
  authorize(p, "guests.manage", { studioId, eventId });
  const event = await prisma.event.findFirst({ where: { id: eventId, studioId } });
  if (!event) throw new Error("Event not found");
  return { p, studioId, eventId, event };
}

function normEmail(v: string | null) { if (!v) return null; const c = normalizeContact(v); return c?.kind === "EMAIL" ? c.value : null; }
function normPhone(v: string | null) { if (!v) return null; const c = normalizeContact(v); return c?.kind === "PHONE" ? c.value : null; }

// ───────────── Households ─────────────

const HouseholdInput = z.object({ name: z.string().min(1, "Household name is required"), plusOnesAllowed: z.coerce.number().int().min(0).default(0), side: z.string().optional(), notes: z.string().optional() });

export async function saveHousehold(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { studioId, eventId } = await guard(fd);
    const id = opt(fd, "householdId");
    const input = HouseholdInput.parse({ name: str(fd, "name"), plusOnesAllowed: str(fd, "plusOnesAllowed") || 0, side: str(fd, "side") || undefined, notes: str(fd, "notes") || undefined });
    const data = { name: input.name, plusOnesAllowed: input.plusOnesAllowed, side: input.side ?? null, notes: input.notes ?? null };
    if (id) {
      const ex = await prisma.household.findFirst({ where: { id, eventId } });
      if (!ex) return { ok: false, error: "Household not found" };
      await prisma.household.update({ where: { id }, data });
    } else {
      const hh = await prisma.household.create({ data: { studioId, eventId, ...data } });
      // Plus-one placeholder slots.
      for (let i = 0; i < input.plusOnesAllowed; i++) await prisma.guest.create({ data: { studioId, eventId, householdId: hh.id, isPlusOne: true } });
    }
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: "Saved." };
  });
}

export async function deleteHousehold(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId } = await guard(fd);
    const id = str(fd, "householdId");
    const hh = await prisma.household.findFirst({ where: { id, eventId }, include: { guests: { where: { deletedAt: null } } } });
    if (!hh) return { ok: false, error: "Household not found" };
    const answered = await prisma.rsvp.count({ where: { guest: { householdId: id }, status: { not: "PENDING" } } });
    if (answered > 0) return { ok: false, error: "Some members already RSVP'd; remove them individually first." };
    await prisma.$transaction(async (tx) => {
      const ids = (await tx.guest.findMany({ where: { householdId: id }, select: { id: true } })).map((g) => g.id);
      await tx.rsvp.deleteMany({ where: { guestId: { in: ids } } });
      await tx.subEventInvite.deleteMany({ where: { guestId: { in: ids } } });
      await tx.inviteToken.updateMany({ where: { guestId: { in: ids } }, data: { revokedAt: new Date() } });
      await tx.guest.updateMany({ where: { householdId: id }, data: { deletedAt: new Date() } });
    });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "household.delete", target: id, data: { guests: hh.guests.length } });
    revalidatePath(base(studioId, eventId));
    return { ok: true };
  });
}

// ───────────── Guests ─────────────

const GuestInput = z.object({
  householdId: z.string().min(1),
  firstName: z.string().optional(), lastName: z.string().optional(),
  email: EmailSchema("Enter a valid email").or(z.literal("")).optional(),
  phone: z.string().optional(),
  isChild: z.boolean(), isPlusOne: z.boolean(), isPrimaryContact: z.boolean(), galleryOnly: z.boolean(),
});

/** Create or update a guest and sync their sub-event invites. */
export async function saveGuest(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId } = await guard(fd);
    const id = opt(fd, "guestId");
    const input = GuestInput.parse({
      householdId: str(fd, "householdId"), firstName: str(fd, "firstName") || undefined, lastName: str(fd, "lastName") || undefined,
      email: str(fd, "email"), phone: str(fd, "phone") || undefined,
      isChild: bool(fd, "isChild"), isPlusOne: bool(fd, "isPlusOne"), isPrimaryContact: bool(fd, "isPrimaryContact"), galleryOnly: bool(fd, "galleryOnly"),
    });
    const hh = await prisma.household.findFirst({ where: { id: input.householdId, eventId } });
    if (!hh) return { ok: false, error: "Household not found" };
    const email = normEmail(input.email || null);
    const phone = input.phone ? normPhone(input.phone) : null;
    if (input.phone && !phone) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { phone: ["Enter a phone with at least 10 digits"] } };
    if (!input.isPlusOne && !input.firstName && !input.lastName) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { firstName: ["Name is required unless this is a plus-one slot"] } };

    // Dedupe by contact within the event.
    const dupe = await prisma.guest.findFirst({ where: { eventId, deletedAt: null, id: id ? { not: id } : undefined, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
    if (dupe) return { ok: false, error: `Another guest in this event already has that ${dupe.email === email ? "email" : "phone"} (${[dupe.firstName, dupe.lastName].filter(Boolean).join(" ") || "unnamed"}).` };

    const data = { householdId: input.householdId, firstName: input.firstName ?? null, lastName: input.lastName ?? null, email, phone, isChild: input.isChild, isPlusOne: input.isPlusOne, isPrimaryContact: input.isPrimaryContact, galleryOnly: input.galleryOnly };
    let guestId = id;
    if (id) {
      const ex = await prisma.guest.findFirst({ where: { id, eventId } });
      if (!ex) return { ok: false, error: "Guest not found" };
      await prisma.guest.update({ where: { id }, data });
    } else {
      guestId = (await prisma.guest.create({ data: { studioId, eventId, ...data } })).id;
    }
    const wanted = new Set(fd.getAll("subEventIds").map(String));
    const sync = await syncInvites(eventId, guestId!, wanted);
    revalidatePath(base(studioId, eventId));
    await audit({ studioId, eventId, actorUserId: p.userId, action: id ? "guest.update" : "guest.create", target: guestId });
    return { ok: true, message: sync.blocked.length ? `Saved. Kept invites for ${sync.blocked.join(", ")} because the guest already answered.` : "Saved." };
  });
}

export async function deleteGuest(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId } = await guard(fd);
    const id = str(fd, "guestId");
    const g = await prisma.guest.findFirst({ where: { id, eventId, deletedAt: null } });
    if (!g) return { ok: false, error: "Guest not found" };
    await prisma.$transaction([
      prisma.rsvp.deleteMany({ where: { guestId: id } }),
      prisma.subEventInvite.deleteMany({ where: { guestId: id } }),
      prisma.inviteToken.updateMany({ where: { guestId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.guest.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    await audit({ studioId, eventId, actorUserId: p.userId, action: "guest.delete", target: id });
    revalidatePath(base(studioId, eventId));
    return { ok: true };
  });
}

// ───────────── CSV import ─────────────

export type ImportRow = {
  line: number;
  household: string; firstName: string; lastName: string; email: string | null; phone: string | null;
  isChild: boolean; plusOnes: number; subEvents: string[];
  errors: string[]; warnings: string[];
};

export type ImportPreview = { rows: ImportRow[]; subEventNames: string[]; households: number; valid: number; invalid: number; headers: string[] };

const REQUIRED = ["household", "first_name"];
const TRUE = new Set(["1", "true", "yes", "y", "x"]);

export async function dryRunImport(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { eventId } = await guard(fd);
    const file = fd.get("file");
    const text = file instanceof File ? await file.text() : str(fd, "csv");
    if (!text.trim()) return { ok: false, error: "Choose a CSV file." };
    const { headers, records } = csvRecords(text);
    const missing = REQUIRED.filter((h) => !headers.includes(h));
    if (missing.length) return { ok: false, error: `Missing required column(s): ${missing.join(", ")}. Download the template for the expected format.` };

    const subs = await prisma.subEvent.findMany({ where: { eventId }, select: { id: true, name: true } });
    const subNames = subs.map((s) => lt(s.name));
    const existing = await prisma.guest.findMany({ where: { eventId, deletedAt: null }, select: { email: true, phone: true } });
    const seenEmail = new Set(existing.map((g) => g.email).filter(Boolean) as string[]);
    const seenPhone = new Set(existing.map((g) => g.phone).filter(Boolean) as string[]);

    const rows: ImportRow[] = records.map((r, i) => {
      const errors: string[] = []; const warnings: string[] = [];
      const household = r.household || "";
      const firstName = r.first_name || ""; const lastName = r.last_name || "";
      const isChild = TRUE.has((r.is_child || "").toLowerCase());
      const plusOnes = parseInt(r.plus_ones || "0", 10) || 0;
      let email: string | null = null; let phone: string | null = null;
      if (!household) errors.push("household is required");
      if (!firstName) errors.push("first_name is required");
      if (r.email) { email = normEmail(r.email); if (!email) errors.push(`invalid email "${r.email}"`); }
      if (r.phone) { phone = normPhone(r.phone); if (!phone) errors.push(`invalid phone "${r.phone}"`); }
      if (email) { if (seenEmail.has(email)) errors.push(`duplicate email ${email} (already in event or earlier in file)`); else seenEmail.add(email); }
      if (phone) { if (seenPhone.has(phone)) errors.push(`duplicate phone ${phone}`); else seenPhone.add(phone); }
      if (!email && !phone && !isChild) warnings.push("adult without contact — will be reached via household only");
      const subEvents = (r.sub_events || "").split(";").map((s) => s.trim()).filter(Boolean);
      const resolved: string[] = [];
      for (const name of subEvents) {
        const m = subNames.find((n) => n.toLowerCase() === name.toLowerCase());
        if (!m) errors.push(`unknown sub-event "${name}"`); else resolved.push(m);
      }
      if (subEvents.length === 0) warnings.push("no sub_events — invited to all");
      return { line: i + 2, household, firstName, lastName, email, phone, isChild, plusOnes, subEvents: resolved.length ? resolved : (subEvents.length === 0 ? subNames : []), errors, warnings };
    });
    const preview: ImportPreview = { rows, subEventNames: subNames, households: new Set(rows.map((r) => r.household)).size, valid: rows.filter((r) => r.errors.length === 0).length, invalid: rows.filter((r) => r.errors.length > 0).length, headers };
    return { ok: true, data: preview };
  });
}

export async function confirmImport(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId } = await guard(fd);
    const payload = JSON.parse(str(fd, "rows")) as ImportRow[];
    const skipInvalid = bool(fd, "skipInvalid");
    const rows = payload.filter((r) => r.errors.length === 0);
    if (!skipInvalid && rows.length !== payload.length) return { ok: false, error: "Fix the invalid rows or tick 'skip invalid rows'." };
    if (rows.length === 0) return { ok: false, error: "Nothing to import." };

    const subs = await prisma.subEvent.findMany({ where: { eventId }, select: { id: true, name: true } });
    const subByName = new Map(subs.map((s) => [lt(s.name).toLowerCase(), s.id]));
    const existing = await prisma.guest.findMany({ where: { eventId, deletedAt: null }, select: { email: true, phone: true } });
    const seenEmail = new Set(existing.map((g) => g.email).filter(Boolean) as string[]);
    const seenPhone = new Set(existing.map((g) => g.phone).filter(Boolean) as string[]);
    const source = `csv:${new Date().toISOString().slice(0, 10)}`;

    let created = 0; let skipped = 0;
    const hhCache = new Map<string, string>();
    for (const r of rows) {
      if ((r.email && seenEmail.has(r.email)) || (r.phone && seenPhone.has(r.phone))) { skipped++; continue; }
      let hhId = hhCache.get(r.household.toLowerCase());
      if (!hhId) {
        const ex = await prisma.household.findFirst({ where: { eventId, name: { equals: r.household, mode: "insensitive" } } });
        const hh = ex ?? await prisma.household.create({ data: { studioId, eventId, name: r.household, plusOnesAllowed: r.plusOnes, importSource: source } });
        if (ex && r.plusOnes > ex.plusOnesAllowed) await prisma.household.update({ where: { id: ex.id }, data: { plusOnesAllowed: r.plusOnes } });
        hhId = hh.id; hhCache.set(r.household.toLowerCase(), hhId);
      }
      const first = await prisma.guest.count({ where: { householdId: hhId, deletedAt: null } }) === 0;
      const g = await prisma.guest.create({ data: { studioId, eventId, householdId: hhId, firstName: r.firstName || null, lastName: r.lastName || null, email: r.email, phone: r.phone, isChild: r.isChild, isPrimaryContact: first && !r.isChild } });
      if (r.email) seenEmail.add(r.email); if (r.phone) seenPhone.add(r.phone);
      const subIds = r.subEvents.map((n) => subByName.get(n.toLowerCase())).filter((x): x is string => !!x);
      for (const sid of subIds) {
        await prisma.subEventInvite.create({ data: { guestId: g.id, subEventId: sid } });
        await prisma.rsvp.create({ data: { guestId: g.id, subEventId: sid } });
      }
      for (let i = 0; i < r.plusOnes; i++) {
        const po = await prisma.guest.create({ data: { studioId, eventId, householdId: hhId, isPlusOne: true } });
        for (const sid of subIds) { await prisma.subEventInvite.create({ data: { guestId: po.id, subEventId: sid } }); await prisma.rsvp.create({ data: { guestId: po.id, subEventId: sid } }); }
      }
      created++;
    }
    await audit({ studioId, eventId, actorUserId: p.userId, action: "guests.import", data: { created, skipped, source } });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: `Imported ${created} guests${skipped ? `, skipped ${skipped} duplicates` : ""}.`, data: { created, skipped } };
  });
}
