import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Table, Badge, Field } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { addMember, removeMember } from "../actions";

export const dynamic = "force-dynamic";

const ROLE_HELP: Record<string, string> = {
  HOST: "The couple/client. Full event control incl. other hosts.",
  COHOST: "Parent/sibling. Same as host minus host and payment management.",
  PLANNER: "Guest list, schedule, RSVP exports. No gallery admin.",
  VENDOR: "Read-only schedule, vendor-tagged albums, meal report.",
  STAFF: "Studio staff assigned to this event (upload/curate).",
};

export default async function MembersPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  const canManage = can(p, "event.members.manage", { studioId, eventId });
  const members = await prisma.eventMember.findMany({ where: { eventId }, include: { user: { include: { contactPoints: true } } }, orderBy: { role: "asc" } });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Event members" padded={false}>
        <Table head={["Role", "Name", "Contact", "Account", ""]}>
          {members.map((m) => (
            <tr key={m.id}>
              <td><Badge tone={m.role === "HOST" ? "blue" : "neutral"} title={ROLE_HELP[m.role]}>{m.role}</Badge>{m.vendorCategory && <span className="ml-1 text-xs text-neutral-500">{m.vendorCategory}</span>}</td>
              <td className="font-medium">{m.user.displayName ?? <span className="text-neutral-400">unnamed</span>}</td>
              <td className="text-xs">{m.user.contactPoints.map((c) => <div key={c.id}>{c.value}{!c.verifiedAt && <span className="ml-1 text-neutral-400">(unverified)</span>}</div>)}</td>
              <td><Badge tone={m.user.status === "CLAIMED" ? "green" : "neutral"}>{m.user.status}</Badge></td>
              <td>{canManage && <ActionButton action={removeMember} fields={{ studioId, eventId, memberId: m.id }} confirm={`Remove ${m.role} membership?`} className="btn-ghost btn-sm text-red-700">Remove</ActionButton>}</td>
            </tr>
          ))}
          {members.length === 0 && <tr><td colSpan={5} className="text-neutral-500">No members yet.</td></tr>}
        </Table>
      </Card>
      {canManage && (
        <Card title="Add member">
          <ActionForm action={addMember} submitLabel="Add" resetOnSuccess>
            <input type="hidden" name="studioId" value={studioId} />
            <input type="hidden" name="eventId" value={eventId} />
            <div className="space-y-3">
              <Field label="Email" name="email"><input id="email" name="email" type="email" className="input" required /><FieldError name="email" /></Field>
              <Field label="Display name (optional)" name="displayName"><input id="displayName" name="displayName" className="input" /></Field>
              <Field label="Role" name="role">
                <select id="role" name="role" className="input" defaultValue="HOST">{Object.keys(ROLE_HELP).map((r) => <option key={r} value={r}>{r}</option>)}</select>
                <FieldError name="role" />
              </Field>
              <Field label="Vendor category (vendors only)" name="vendorCategory"><input id="vendorCategory" name="vendorCategory" className="input" placeholder="decor, catering, venue…" /></Field>
            </div>
            <ul className="mt-3 space-y-0.5 text-[11px] text-neutral-500">{Object.entries(ROLE_HELP).map(([r, h]) => <li key={r}><span className="font-medium text-neutral-700">{r}</span> — {h}</li>)}</ul>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
