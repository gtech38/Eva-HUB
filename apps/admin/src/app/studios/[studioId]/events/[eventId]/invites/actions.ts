"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma, enqueue } from "@hub/db";
import { email, sms, eventOrigin, hashToken, newToken } from "@hub/shared";
import { act, str, bool, type ActionState } from "@/lib/action";
import { authorize, requireSignedIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { inviteExpiry } from "@hub/shared/invites";
import { buildMessages, type Ev, type G } from "@/lib/invites";
import { eventWithDates } from "@/lib/inviteTokens";

const base = (studioId: string, eventId: string) => `/studios/${studioId}/events/${eventId}/invites`;

async function loadEvent(studioId: string, eventId: string) {
  const event = await eventWithDates(studioId, eventId);
  if (!event) throw new Error("Event not found");
  return event;
}

async function guard(fd: FormData) {
  const p = await requireSignedIn();
  const studioId = str(fd, "studioId"); const eventId = str(fd, "eventId");
  authorize(p, "invites.send", { studioId, eventId });
  return { p, studioId, eventId, event: await loadEvent(studioId, eventId) };
}

/** Issue a token per channel for one guest and deliver. Returns per-channel results. */
async function deliver(event: Ev, guest: G, channels: Set<"EMAIL" | "PHONE">, intro: string, optedOut: Set<string>, expiresAt: Date) {
  const results: Array<{ channel: "EMAIL" | "PHONE"; to: string; ok: boolean; error?: string }> = [];
  const targets: Array<["EMAIL" | "PHONE", string]> = [];
  if (channels.has("EMAIL") && guest.email) targets.push(["EMAIL", guest.email]);
  if (channels.has("PHONE") && guest.phone) targets.push(["PHONE", guest.phone]);
  for (const [channel, to] of targets) {
    if (channel === "PHONE" && optedOut.has(to)) {
      await prisma.message.create({ data: { studioId: event.studioId, eventId: event.id, householdId: guest.householdId, guestId: guest.id, channel, purpose: "INVITATION", to, locale: event.defaultLocale, status: "SUPPRESSED", error: "sms opt-out" } });
      results.push({ channel, to, ok: false, error: "opted out" }); continue;
    }
    const token = newToken();
    await prisma.inviteToken.create({ data: { tokenHash: hashToken(token), guestId: guest.id, channel, sentTo: to, expiresAt } });
    const link = `${eventOrigin(event.slug)}/i/${token}`;
    const m = buildMessages(event, guest, link, intro);
    try {
      const r = channel === "EMAIL" ? await email().send({ to, subject: m.subject, text: m.text, html: m.html }) : await sms().send({ to, body: m.smsBody });
      await prisma.message.create({ data: { studioId: event.studioId, eventId: event.id, householdId: guest.householdId, guestId: guest.id, channel, purpose: "INVITATION", to, locale: event.defaultLocale, status: "SENT", providerId: r.providerId } });
      results.push({ channel, to, ok: true });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await prisma.message.create({ data: { studioId: event.studioId, eventId: event.id, householdId: guest.householdId, guestId: guest.id, channel, purpose: "INVITATION", to, locale: event.defaultLocale, status: "FAILED", error: err } });
      results.push({ channel, to, ok: false, error: err });
    }
  }
  return results;
}

async function optOuts(phones: string[]) {
  if (phones.length === 0) return new Set<string>();
  const cps = await prisma.contactPoint.findMany({ where: { kind: "PHONE", value: { in: phones }, smsOptOut: true }, select: { value: true } });
  return new Set(cps.map((c) => c.value));
}

export async function sendInvitations(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId, event } = await guard(fd);
    const channels = new Set(fd.getAll("channels").map(String).filter((c): c is "EMAIL" | "PHONE" => c === "EMAIL" || c === "PHONE"));
    if (channels.size === 0) return { ok: false, error: "Pick at least one channel." };
    const scope = str(fd, "scope") === "pending" ? "pending" : "all";
    const intro = str(fd, "intro").slice(0, 1000);
    const onlyUnsent = bool(fd, "onlyUnsent");

    const guests = await prisma.guest.findMany({
      where: {
        eventId, deletedAt: null, isChild: false,
        OR: [{ email: { not: null } }, { phone: { not: null } }],
        ...(scope === "pending" ? { household: { guests: { some: { deletedAt: null, rsvps: { some: { status: "PENDING" } } } } } } : {}),
        ...(onlyUnsent ? { inviteTokens: { none: { revokedAt: null } } } : {}),
      },
    });
    const opted = await optOuts(guests.map((g) => g.phone).filter((x): x is string => !!x));
    const expiresAt = inviteExpiry(event);
    let sent = 0; let failed = 0; let suppressed = 0;
    for (const g of guests) {
      for (const r of await deliver(event, g, channels, intro, opted, expiresAt)) { if (r.ok) sent++; else if (r.error === "opted out") suppressed++; else failed++; }
    }
    await audit({ studioId, eventId, actorUserId: p.userId, action: "invites.send", data: { channels: [...channels], scope, guests: guests.length, sent, failed, suppressed } });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: `Sent ${sent} message${sent === 1 ? "" : "s"} to ${guests.length} guest${guests.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}${suppressed ? `, ${suppressed} suppressed (opt-out)` : ""}.` };
  });
}

/** Revoke a guest's live tokens and issue fresh ones on every channel they have. */
export async function resendInvite(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId, event } = await guard(fd);
    const guest = await prisma.guest.findFirst({ where: { id: str(fd, "guestId"), eventId, deletedAt: null } });
    if (!guest) return { ok: false, error: "Guest not found" };
    if (guest.isChild) return { ok: false, error: "Children don't receive invitations; reach them through their household." };
    if (!guest.email && !guest.phone) return { ok: false, error: "Guest has no email or phone." };
    const revoked = await prisma.inviteToken.updateMany({ where: { guestId: guest.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const opted = await optOuts(guest.phone ? [guest.phone] : []);
    const results = await deliver(event, guest, new Set(["EMAIL", "PHONE"]), "", opted, inviteExpiry(event));
    await audit({ studioId, eventId, actorUserId: p.userId, action: "invite.resend", target: guest.id, data: { revoked: revoked.count, results } });
    revalidatePath(base(studioId, eventId));
    const ok = results.filter((r) => r.ok).length;
    return { ok: ok > 0, message: ok > 0 ? `Resent (${results.filter((r) => r.ok).map((r) => r.channel.toLowerCase()).join(", ")}); ${revoked.count} old link${revoked.count === 1 ? "" : "s"} revoked.` : undefined, error: ok === 0 ? results.map((r) => r.error).join("; ") : undefined };
  });
}

const RuleInput = z.object({ sendAt: z.string().min(1, "Pick a date and time"), channel: z.enum(["EMAIL", "PHONE"]), subEventIds: z.array(z.string()) });

export async function saveReminderRule(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId } = await guard(fd);
    const input = RuleInput.parse({ sendAt: str(fd, "sendAt"), channel: str(fd, "channel"), subEventIds: fd.getAll("subEventIds").map(String) });
    const sendAt = new Date(input.sendAt);
    if (sendAt.getTime() < Date.now()) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { sendAt: ["Must be in the future"] } };
    const rule = await prisma.reminderRule.create({ data: { eventId, sendAt, channel: input.channel, subEventIds: input.subEventIds } });
    // TODO(worker/web): FIRE_REMINDER handler finds households with PENDING invited sub-events and sends the reminder.
    await enqueue("FIRE_REMINDER", { reminderRuleId: rule.id, eventId }, { runAt: sendAt, dedupeKey: `reminder:${rule.id}` });
    await audit({ studioId, eventId, actorUserId: p.userId, action: "reminder.create", target: rule.id, data: { sendAt: sendAt.toISOString(), channel: input.channel, subEventIds: input.subEventIds } });
    revalidatePath(base(studioId, eventId));
    return { ok: true, message: "Reminder scheduled." };
  });
}

export async function deleteReminderRule(_p: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { p, studioId, eventId } = await guard(fd);
    const id = str(fd, "ruleId");
    const rule = await prisma.reminderRule.findFirst({ where: { id, eventId } });
    if (!rule) return { ok: false, error: "Rule not found" };
    if (rule.firedAt) return { ok: false, error: "This reminder already fired." };
    await prisma.$transaction([
      prisma.job.deleteMany({ where: { dedupeKey: `reminder:${id}`, status: "QUEUED" } }),
      prisma.reminderRule.delete({ where: { id } }),
    ]);
    await audit({ studioId, eventId, actorUserId: p.userId, action: "reminder.delete", target: id });
    revalidatePath(base(studioId, eventId));
    return { ok: true };
  });
}

export async function previewInvite(studioId: string, eventId: string, intro: string) {
  const p = await requireSignedIn();
  authorize(p, "invites.send", { studioId, eventId });
  const event = await loadEvent(studioId, eventId);
  const sample: G = { id: "sample", householdId: "", firstName: "Lakshmi", lastName: "Rao", email: "lakshmi@example.com", phone: "+15125550101", isPlusOne: false };
  const link = `${eventOrigin(event.slug)}/i/<token>`;
  const m = buildMessages(event, sample, link, intro);
  return { subject: m.subject, text: m.text, smsBody: m.smsBody, expires: inviteExpiry(event).toISOString() };
}
