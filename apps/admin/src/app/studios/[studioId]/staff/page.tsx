import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getStudio } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Card, Table, Badge, Field } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { addStaff, removeStaff } from "../actions";

export const dynamic = "force-dynamic";

export default async function StaffPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const p = await requireAdmin(studioId);
  const studio = await getStudio(studioId);
  const canManage = can(p, "studio.manage", { studioId });
  const members = await prisma.studioMember.findMany({
    where: { studioId },
    include: { user: { include: { contactPoints: true, eventMembers: { where: { role: "STAFF", event: { studioId } }, include: { event: { select: { slug: true } } } } } } },
    orderBy: { role: "asc" },
  });

  return (
    <>
      <PageHeader title="Staff" description="Owners manage billing, settings and every event. Staff can upload and curate only events they're assigned to (Event → Members → STAFF)." crumbs={[{ href: `/studios/${studioId}`, label: studio.name }, { label: "Staff" }]} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Members" padded={false}>
          <Table head={["Name", "Contact", "Role", "Assigned events", ""]}>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{m.user.displayName ?? <span className="text-neutral-400">unnamed</span>}{m.user.isPlatformAdmin && <Badge tone="purple">platform admin</Badge>}</td>
                <td className="text-xs">{m.user.contactPoints.map((c) => <div key={c.id}>{c.value}{!c.verifiedAt && <span className="ml-1 text-neutral-400">(unverified)</span>}</div>)}</td>
                <td><Badge tone={m.role === "OWNER" ? "blue" : "neutral"}>{m.role}</Badge></td>
                <td className="text-xs text-neutral-600">{m.role === "OWNER" ? "all" : m.user.eventMembers.map((e) => e.event.slug).join(", ") || <span className="text-neutral-400">none</span>}</td>
                <td>{canManage && m.userId !== p.userId && <ActionButton action={removeStaff} fields={{ studioId, memberId: m.id }} confirm="Remove this member from the studio?" className="btn-ghost btn-sm text-red-700">Remove</ActionButton>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        {canManage && (
          <Card title="Add member">
            <ActionForm action={addStaff} submitLabel="Add" resetOnSuccess>
              <input type="hidden" name="studioId" value={studioId} />
              <div className="space-y-3">
                <Field label="Email" name="email"><input id="email" name="email" type="email" className="input" required /><FieldError name="email" /></Field>
                <Field label="Display name (optional)" name="displayName"><input id="displayName" name="displayName" className="input" /></Field>
                <Field label="Role" name="role">
                  <select id="role" name="role" className="input" defaultValue="STAFF"><option value="STAFF">STAFF</option><option value="OWNER">OWNER</option></select>
                  <FieldError name="role" />
                </Field>
              </div>
              <p className="help">New emails get an unclaimed account; they sign in via magic link at this admin.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
