import Link from "next/link";
import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Badge, Field, Empty } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { fullName, lt } from "@/lib/format";
import { saveHousehold, saveGuest, deleteGuest, deleteHousehold } from "./actions";

export const dynamic = "force-dynamic";

const RSVP_TONE = { PENDING: "neutral", ATTENDING: "green", DECLINED: "red" } as const;

type Sub = { id: string; name: unknown; servesMeal: boolean };

function GuestForm({ studioId, eventId, householdId, subs, guest }: { studioId: string; eventId: string; householdId: string; subs: Sub[]; guest?: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; isChild: boolean; isPlusOne: boolean; isPrimaryContact: boolean; galleryOnly: boolean; invites: Array<{ subEventId: string }> } }) {
  return (
    <ActionForm action={saveGuest} submitLabel={guest ? "Save guest" : "Add guest"} resetOnSuccess={!guest} className="rounded border border-neutral-200 bg-neutral-50 p-3">
      <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="householdId" value={householdId} />
      {guest && <input type="hidden" name="guestId" value={guest.id} />}
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="First name"><input name="firstName" className="input" defaultValue={guest?.firstName ?? ""} /><FieldError name="firstName" /></Field>
        <Field label="Last name"><input name="lastName" className="input" defaultValue={guest?.lastName ?? ""} /></Field>
        <Field label="Email"><input name="email" type="email" className="input" defaultValue={guest?.email ?? ""} /><FieldError name="email" /></Field>
        <Field label="Phone"><input name="phone" className="input" placeholder="+1 512 555 0100" defaultValue={guest?.phone ?? ""} /><FieldError name="phone" /></Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="isChild" defaultChecked={guest?.isChild} /> Child</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="isPlusOne" defaultChecked={guest?.isPlusOne} /> Plus-one slot</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="isPrimaryContact" defaultChecked={guest?.isPrimaryContact} /> Primary contact</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="galleryOnly" defaultChecked={guest?.galleryOnly} /> Gallery only (no sub-event invites)</label>
      </div>
      <div className="mt-2">
        <span className="label">Invited to</span>
        <div className="flex flex-wrap gap-3 text-xs">
          {subs.map((s) => <label key={s.id} className="flex items-center gap-1.5"><input type="checkbox" name="subEventIds" value={s.id} defaultChecked={guest ? guest.invites.some((i) => i.subEventId === s.id) : true} /> {lt(s.name)}</label>)}
          {subs.length === 0 && <span className="text-neutral-400">No sub-events yet.</span>}
        </div>
        <p className="help">Unticking removes the invite and its pending RSVP. Answered RSVPs are kept.</p>
      </div>
    </ActionForm>
  );
}

export default async function GuestsPage({ params, searchParams }: { params: Promise<{ studioId: string; eventId: string }>; searchParams: Promise<{ q?: string; edit?: string; hh?: string }> }) {
  const { studioId, eventId } = await params;
  const { q = "", edit, hh: editHh } = await searchParams;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  const canManage = can(p, "guests.manage", { studioId, eventId });
  const base = `/studios/${studioId}/events/${eventId}/guests`;

  const subs = await prisma.subEvent.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }], select: { id: true, name: true, servesMeal: true } });
  const households = await prisma.household.findMany({
    where: { eventId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { guests: { some: { deletedAt: null, OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } } }] } : {}) },
    orderBy: { createdAt: "asc" },
    include: { guests: { where: { deletedAt: null }, orderBy: [{ isPlusOne: "asc" }, { isChild: "asc" }, { createdAt: "asc" }], include: { invites: true, rsvps: { include: { mealOption: true } }, inviteTokens: { where: { revokedAt: null }, select: { channel: true, lastUsedAt: true } } } } },
  });
  const totalGuests = households.reduce((a, h) => a + h.guests.length, 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <form className="flex gap-2">
          <input name="q" defaultValue={q} className="input w-64" placeholder="Search households and guests" />
          <button className="btn-secondary">Search</button>
          {q && <Link href={base} className="btn-ghost">Clear</Link>}
        </form>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{households.length} households · {totalGuests} guests</span>
          <Link href={`${base}/report`} className="btn-secondary">RSVP report</Link>
          {canManage && <Link href={`${base}/import`} className="btn-secondary">Import CSV</Link>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {households.length === 0 && <Empty>No households{q ? " match" : " yet"}. Add one on the right or import a CSV.</Empty>}
          {households.map((h) => (
            <Card key={h.id} padded={false}
              title={<span>{h.name} <span className="ml-2 font-normal text-neutral-400">{h.side ?? ""}{h.plusOnesAllowed ? ` · +${h.plusOnesAllowed}` : ""}{h.importSource ? ` · ${h.importSource}` : ""}</span></span>}
              actions={canManage && <div className="flex items-center gap-1">
                <Link href={`${base}?hh=${h.id}`} className="btn-ghost btn-sm">Edit</Link>
                <ActionButton action={deleteHousehold} fields={{ studioId, eventId, householdId: h.id }} confirm={`Remove household "${h.name}" and all its members?`} className="btn-ghost btn-sm text-red-700">Remove</ActionButton>
              </div>}>
              {editHh === h.id && canManage && (
                <div className="border-b border-neutral-200 p-3">
                  <ActionForm action={saveHousehold} submitLabel="Save household" className="grid gap-2 sm:grid-cols-[1fr_90px_120px_1fr]" footer={<Link href={base} className="btn-ghost btn-sm">Cancel</Link>}>
                    <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="householdId" value={h.id} />
                    <Field label="Name"><input name="name" className="input" defaultValue={h.name} required /><FieldError name="name" /></Field>
                    <Field label="Plus-ones"><input name="plusOnesAllowed" type="number" min={0} className="input" defaultValue={h.plusOnesAllowed} /></Field>
                    <Field label="Side"><input name="side" className="input" defaultValue={h.side ?? ""} placeholder="bride / groom" /></Field>
                    <Field label="Private notes"><input name="notes" className="input" defaultValue={h.notes ?? ""} /></Field>
                  </ActionForm>
                </div>
              )}
              <table className="table">
                <thead><tr><th>Guest</th><th>Contact</th><th>Flags</th>{subs.map((s) => <th key={s.id}>{lt(s.name)}</th>)}<th></th></tr></thead>
                <tbody>
                  {h.guests.map((g) => (
                    <tr key={g.id} className={edit === g.id ? "bg-amber-50" : ""}>
                      <td>
                        <div className="font-medium">{fullName(g)}</div>
                        <div className="flex gap-1 text-[11px]">{g.userId ? <Badge tone="green" title={`Linked to user ${g.userId}`}>linked</Badge> : <span className="text-neutral-400">unlinked</span>}{g.inviteTokens.length > 0 && <Badge tone="blue" title="Active invitation link(s)">{g.inviteTokens.length} invite{g.inviteTokens.length > 1 ? "s" : ""}</Badge>}</div>
                      </td>
                      <td className="text-xs">{g.email && <div>{g.email}</div>}{g.phone && <div>{g.phone}</div>}{!g.email && !g.phone && <span className="text-neutral-400">—</span>}</td>
                      <td><div className="flex flex-wrap gap-1">{g.isChild && <Badge>child</Badge>}{g.isPlusOne && <Badge>plus-one</Badge>}{g.isPrimaryContact && <Badge tone="blue">primary</Badge>}{g.galleryOnly && <Badge tone="purple">gallery only</Badge>}{g.faceSearchOptOut && <Badge tone="amber">no face search</Badge>}</div></td>
                      {subs.map((s) => {
                        const inv = g.invites.some((i) => i.subEventId === s.id);
                        const r = g.rsvps.find((x) => x.subEventId === s.id);
                        if (!inv) return <td key={s.id} className="text-neutral-300">—</td>;
                        return <td key={s.id}><Badge tone={RSVP_TONE[r?.status ?? "PENDING"]}>{r?.status ?? "PENDING"}</Badge>{r?.mealOption && <div className="mt-0.5 text-[11px] text-neutral-500">{lt(r.mealOption.label)}</div>}</td>;
                      })}
                      <td className="whitespace-nowrap">{canManage && <div className="flex items-center gap-1"><Link href={`${base}?edit=${g.id}#g-${g.id}`} className="btn-ghost btn-sm">Edit</Link><ActionButton action={deleteGuest} fields={{ studioId, eventId, guestId: g.id }} confirm={`Remove ${fullName(g)}?`} className="btn-ghost btn-sm text-red-700">×</ActionButton></div>}</td>
                    </tr>
                  ))}
                  {h.guests.length === 0 && <tr><td colSpan={4 + subs.length} className="text-xs text-neutral-400">No members.</td></tr>}
                </tbody>
              </table>
              {canManage && (
                <div className="border-t border-neutral-200 p-3">
                  {edit && h.guests.some((g) => g.id === edit) ? (
                    <div id={`g-${edit}`}>
                      <div className="mb-1 flex items-center justify-between text-xs font-medium">Edit {fullName(h.guests.find((g) => g.id === edit)!)} <Link href={base} className="font-normal underline">cancel</Link></div>
                      <GuestForm studioId={studioId} eventId={eventId} householdId={h.id} subs={subs} guest={h.guests.find((g) => g.id === edit)!} />
                    </div>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-xs text-neutral-600 hover:text-neutral-900">+ Add member to {h.name}</summary>
                      <div className="mt-2"><GuestForm studioId={studioId} eventId={eventId} householdId={h.id} subs={subs} /></div>
                    </details>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
        {canManage && (
          <div className="space-y-4">
            <Card title="Add household">
              <ActionForm action={saveHousehold} submitLabel="Add household" resetOnSuccess>
                <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
                <div className="space-y-2">
                  <Field label="Name"><input name="name" className="input" placeholder="The Rao Family" required /><FieldError name="name" /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Plus-ones" help="Creates unnamed slots."><input name="plusOnesAllowed" type="number" min={0} className="input" defaultValue={0} /></Field>
                    <Field label="Side"><input name="side" className="input" placeholder="bride / groom" /></Field>
                  </div>
                  <Field label="Private notes"><input name="notes" className="input" /></Field>
                </div>
              </ActionForm>
            </Card>
            <Card title="Legend">
              <ul className="space-y-1 text-xs text-neutral-600">
                <li><Badge tone="green">linked</Badge> guest row is tied to a verified user account (clicked an invite)</li>
                <li><Badge tone="blue">N invites</Badge> active invitation links</li>
                <li><Badge tone="purple">gallery only</Badge> can see photos, gets no sub-event invites</li>
                <li>RSVP chips: one per sub-event the guest is invited to; the meal choice appears beneath.</li>
              </ul>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
