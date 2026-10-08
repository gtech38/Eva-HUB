import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Table, Badge, Field, StatusBadge } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { fullName, lt, fmtDateTime } from "@/lib/format";
import { InviteComposer } from "./InviteComposer";
import { resendInvite, saveReminderRule, deleteReminderRule } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvitesPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  const event = await getEvent(studioId, eventId);
  const canSend = can(p, "invites.send", { studioId, eventId });

  const guests = await prisma.guest.findMany({
    where: { eventId, deletedAt: null, isChild: false, OR: [{ email: { not: null } }, { phone: { not: null } }] },
    include: { household: { select: { name: true } }, inviteTokens: { orderBy: { expiresAt: "desc" } }, rsvps: { select: { status: true } } },
    orderBy: [{ household: { name: "asc" } }, { createdAt: "asc" }],
  });
  const messages = await prisma.message.findMany({ where: { eventId, purpose: "INVITATION" }, orderBy: { createdAt: "desc" } });
  const lastMsg = (guestId: string) => messages.find((m) => m.guestId === guestId);
  const pendingHouseholds = new Set((await prisma.rsvp.findMany({ where: { status: "PENDING", guest: { eventId, deletedAt: null } }, select: { guest: { select: { householdId: true } } } })).map((r) => r.guest.householdId));
  const stats = { recipients: guests.length, withEmail: guests.filter((g) => g.email).length, withPhone: guests.filter((g) => g.phone).length, pending: guests.filter((g) => pendingHouseholds.has(g.householdId)).length, unsent: guests.filter((g) => !g.inviteTokens.some((t) => !t.revokedAt)).length };
  const subs = await prisma.subEvent.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const rules = await prisma.reminderRule.findMany({ where: { eventId }, orderBy: { sendAt: "asc" } });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Send invitations">
          {canSend ? <InviteComposer studioId={studioId} eventId={eventId} stats={stats} /> : <p className="text-xs text-amber-800">You don't have permission to send invitations.</p>}
        </Card>
        <Card title="Reminder">
          <p className="mb-2 text-xs text-neutral-500">At the chosen time, households with any pending invited sub-event get a nudge (SMS, or email if no phone). Scheduling enqueues a FIRE_REMINDER job; the worker fires it.</p>
          <ul className="mb-3 space-y-1 text-xs">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1.5">
                <span>{fmtDateTime(r.sendAt)} · {r.channel === "PHONE" ? "SMS" : "Email"} · {r.subEventIds.length ? r.subEventIds.map((id) => lt(subs.find((s) => s.id === id)?.name)).join(", ") : "all sub-events"} {r.firedAt ? <Badge tone="green">fired</Badge> : <Badge>scheduled</Badge>}</span>
                {canSend && !r.firedAt && <ActionButton action={deleteReminderRule} fields={{ studioId, eventId, ruleId: r.id }} className="btn-ghost btn-sm text-red-700">×</ActionButton>}
              </li>
            ))}
            {rules.length === 0 && <li className="text-neutral-400">No reminders scheduled.</li>}
          </ul>
          {canSend && (
            <ActionForm action={saveReminderRule} submitLabel="Schedule reminder" submitClassName="btn-secondary" resetOnSuccess>
              <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
              <div className="space-y-2">
                <Field label="Send at"><input name="sendAt" type="datetime-local" className="input" required /><FieldError name="sendAt" /></Field>
                <Field label="Channel"><select name="channel" className="input" defaultValue="PHONE"><option value="PHONE">SMS (email fallback)</option><option value="EMAIL">Email</option></select></Field>
                <div><span className="label">Sub-events (blank = all)</span><div className="flex flex-wrap gap-2 text-xs">{subs.map((s) => <label key={s.id} className="flex items-center gap-1"><input type="checkbox" name="subEventIds" value={s.id} /> {lt(s.name)}</label>)}</div></div>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>

      <Card title={<span>Recipients <span className="ml-1 font-normal text-neutral-400">adults with a contact · {guests.length}</span></span>} padded={false}>
        <Table head={["Guest", "Household", "Email", "Phone", "RSVP", "Active links", "Last message", ""]}>
          {guests.map((g) => {
            const live = g.inviteTokens.filter((t) => !t.revokedAt);
            const m = lastMsg(g.id);
            const pend = g.rsvps.filter((r) => r.status === "PENDING").length;
            return (
              <tr key={g.id}>
                <td className="font-medium">{fullName(g)}</td>
                <td className="text-xs text-neutral-600">{g.household.name}</td>
                <td className="text-xs">{g.email ?? <span className="text-neutral-300">—</span>}</td>
                <td className="text-xs">{g.phone ?? <span className="text-neutral-300">—</span>}</td>
                <td className="text-xs">{g.rsvps.length === 0 ? <span className="text-neutral-400">not invited</span> : pend === 0 ? <Badge tone="green">answered</Badge> : <Badge>{pend} pending</Badge>}</td>
                <td className="text-xs">{live.length === 0 ? <span className="text-neutral-400">none</span> : live.map((t) => <div key={t.id}>{t.channel === "EMAIL" ? "email" : "sms"} · exp {fmtDateTime(t.expiresAt)}{t.lastUsedAt && <span className="text-green-700"> · opened</span>}</div>)}</td>
                <td className="text-xs">{m ? <><StatusBadge status={m.status} /> <span className="text-neutral-500">{fmtDateTime(m.createdAt)}</span>{m.error && <div className="text-red-700">{m.error}</div>}</> : <span className="text-neutral-400">—</span>}</td>
                <td>{canSend && <ActionButton action={resendInvite} fields={{ studioId, eventId, guestId: g.id }} confirm={`Revoke ${fullName(g)}'s existing links and send new ones?`} pendingText="Sending…">{live.length ? "Resend" : "Send"}</ActionButton>}</td>
              </tr>
            );
          })}
          {guests.length === 0 && <tr><td colSpan={8} className="text-neutral-500">No adult guests with an email or phone yet.</td></tr>}
        </Table>
      </Card>
      <p className="text-[11px] text-neutral-400">Event {lt(event.title)} · site {event.slug}. SMS uses the console provider locally (check the dev server log). Email goes to Mailpit.</p>
    </div>
  );
}
