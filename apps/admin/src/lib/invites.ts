import { lt } from "@/lib/format";

export type Ev = { id: string; studioId: string; slug: string; title: unknown; startsOn: Date | null; defaultLocale: string };
export type G = { id: string; householdId: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; isPlusOne: boolean };

export function buildMessages(event: Ev, guest: G, link: string, intro: string) {
  const title = lt(event.title) || event.slug;
  const name = guest.firstName || "there";
  const text = `Hi ${name},\n\n${intro || `You're invited to ${title}.`}\n\nOpen your personal invitation to see the schedule and RSVP:\n${link}\n\nThis link is personal to you — please don't forward it. If someone else needs access, they can request their own link on the site.\n\nPhotos from the event may be indexed for face search; you can opt out from the gallery at any time.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222"><p>Hi ${esc(name)},</p><p>${esc(intro || `You're invited to ${title}.`)}</p><p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#222;color:#fff;text-decoration:none;border-radius:4px">Open your invitation</a></p><p style="font-size:12px;color:#666">Or paste this link: ${link}</p><p style="font-size:12px;color:#666">This link is personal to you — please don't forward it. Photos from the event may be indexed for face search; you can opt out from the gallery at any time.</p></div>`;
  const smsBody = `${title}: you're invited! Schedule & RSVP: ${link}`;
  return { subject: `You're invited: ${title}`, text, html, smsBody };
}
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); }
