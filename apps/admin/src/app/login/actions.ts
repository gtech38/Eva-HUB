"use server";

import { z } from "zod";
import { prisma } from "@hub/db";
import { email, env, hashToken, newToken, normalizeContact } from "@hub/shared";
import { addressAtIp, rateLimits } from "@hub/shared/ratePolicies";
import { clientIp } from "@hub/shared/clientIp";
import { headers } from "next/headers";
import { act, EmailSchema, type ActionState } from "@/lib/action";

/** Per IP, then per (address, IP), then the looser address-only cap. A limiter error counts as "no". */
async function withinMagicLinkLimits(address: string): Promise<boolean> {
  try {
    const ip = clientIp(await headers());
    if (!(await rateLimits.check("adminMagicLinkIp", ip)).ok) return false;
    if (!(await rateLimits.check("adminMagicLinkAddressIp", addressAtIp(address, ip))).ok) return false;
    return (await rateLimits.check("adminMagicLinkAddress", address)).ok;
  } catch (err) {
    console.error("[admin-login] rate limiter unavailable", (err as Error).message);
    return false;
  }
}

const Schema = z.object({ email: EmailSchema("Enter a valid email address") });

const SAME_MESSAGE = "If you have an account, we've sent a sign-in link to that address. It expires in 15 minutes.";

export async function requestMagicLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const { email: raw } = Schema.parse({ email: (fd.get("email") ?? "").toString().trim() });
    const contact = normalizeContact(raw);
    if (!contact || contact.kind !== "EMAIL") return { ok: true, message: SAME_MESSAGE };
    // Before the account lookup so members and strangers are counted alike; over the limit (or if
    // the limiter itself fails) nothing is sent or written and the reply does not change (SHR-003).
    if (!(await withinMagicLinkLimits(contact.value))) return { ok: true, message: SAME_MESSAGE };

    const cp = await prisma.contactPoint.findUnique({
      where: { kind_value: { kind: "EMAIL", value: contact.value } },
      include: { user: { include: { studioMembers: { select: { id: true } } } } },
    });
    const u = cp?.user;
    const eligible = !!u && !u.deletedAt && u.status !== "DISABLED" && (u.isPlatformAdmin || u.studioMembers.length > 0);

    if (eligible) {
      const token = newToken();
      await prisma.loginToken.create({
        data: {
          tokenHash: hashToken(token),
          purpose: "MAGIC_LINK",
          channel: "EMAIL",
          sentTo: contact.value,
          userId: u.id,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      const link = `${env().ADMIN_ORIGIN}/auth/callback?token=${encodeURIComponent(token)}`;
      await email().send({
        to: contact.value,
        subject: "Your Event Hub admin sign-in link",
        text: `Sign in to Event Hub admin:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
        html: `<p>Sign in to Event Hub admin:</p><p><a href="${link}">${link}</a></p><p style="color:#666;font-size:12px">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
      });
    } else {
      // Same timing-ish shape; never reveal account existence.
      await prisma.loginToken.create({
        data: { tokenHash: hashToken(newToken()), purpose: "MAGIC_LINK", channel: "EMAIL", sentTo: contact.value, userId: null, expiresAt: new Date(Date.now() + 15 * 60_000) },
      });
    }
    return { ok: true, message: SAME_MESSAGE };
  });
}
