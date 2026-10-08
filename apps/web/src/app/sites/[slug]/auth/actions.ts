"use server";

import { prisma } from "@hub/db";
import { email, sms } from "@hub/shared";
import { newToken, hashToken, normalizeContact } from "@hub/shared/auth";
import { eventOrigin } from "@hub/shared/env";
import { t, ui } from "@hub/shared/i18n";
import { getSite } from "@/lib/site";

export type SignInState = { message: string } | null;

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * "Enter the email or phone your invitation was sent to."
 * Always answers with the same sentence so the form cannot be used to enumerate the guest list.
 */
export async function requestSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const site = await getSite();
  if (!site) return { message: ui("signInSent", "en") };
  const { event, locale } = site;
  const done = { message: ui("signInSent", locale) };

  const contact = normalizeContact(String(formData.get("contact") ?? ""));
  if (!contact) return done;

  try {
    // Who is this address? A guest of THIS event, or a member (host/planner/staff) whose verified contact matches.
    const guestWhere = contact.kind === "EMAIL" ? { email: contact.value } : { phone: contact.value };
    const [guests, contactPoint] = await Promise.all([
      prisma.guest.findMany({ where: { eventId: event.id, deletedAt: null, ...guestWhere }, select: { id: true, userId: true } }),
      prisma.contactPoint.findUnique({ where: { kind_value: { kind: contact.kind, value: contact.value } }, select: { userId: true } }),
    ]);

    const userId: string | null = contactPoint?.userId ?? guests.find((g) => g.userId)?.userId ?? null;
    let eligible = guests.length > 0;
    if (!eligible && userId) {
      const [linkedGuest, member, staff, admin] = await Promise.all([
        prisma.guest.findFirst({ where: { eventId: event.id, userId, deletedAt: null }, select: { id: true } }),
        prisma.eventMember.findFirst({ where: { eventId: event.id, userId }, select: { id: true } }),
        prisma.studioMember.findFirst({ where: { studioId: event.studioId, userId }, select: { id: true } }),
        prisma.user.findFirst({ where: { id: userId, isPlatformAdmin: true }, select: { id: true } }),
      ]);
      eligible = !!(linkedGuest || member || staff || admin);
    }
    if (!eligible) {
      // Not on the list. Same response, no token, nothing sent.
      return done;
    }

    const token = newToken();
    await prisma.loginToken.create({
      data: {
        tokenHash: hashToken(token),
        purpose: "MAGIC_LINK",
        channel: contact.kind,
        sentTo: contact.value,
        userId,
        eventId: event.id,
        redirectTo: "/",
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      },
    });

    const title = t(event.title as object, locale);
    const link = `${eventOrigin(event.slug)}/auth/callback?token=${encodeURIComponent(token)}`;
    let providerId: string | undefined;
    if (contact.kind === "EMAIL") {
      const r = await email().send({
        to: contact.value,
        subject: `${ui("signIn", locale)} · ${title}`,
        text: `${title}\n\n${ui("signIn", locale)}: ${link}\n\nThis link works once and expires in 15 minutes. If you did not request it, you can ignore this email.`,
        html: `<p style="font-family:Georgia,serif;font-size:20px">${escapeHtml(title)}</p><p><a href="${link}">${escapeHtml(ui("signIn", locale))}</a></p><p style="color:#666;font-size:13px">This link works once and expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
      });
      providerId = r.providerId;
    } else {
      const r = await sms().send({ to: contact.value, body: `${title}: ${link}` });
      providerId = r.providerId;
    }
    await prisma.message.create({
      data: {
        studioId: event.studioId,
        eventId: event.id,
        guestId: guests[0]?.id ?? null,
        channel: contact.kind,
        purpose: "MAGIC_LINK",
        to: contact.value,
        locale,
        providerId,
        status: "SENT",
      },
    });
  } catch (err) {
    console.error("[sign-in] failed", err);
  }
  return done;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
