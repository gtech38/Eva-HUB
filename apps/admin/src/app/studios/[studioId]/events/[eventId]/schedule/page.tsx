import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Field, LocalizedInputs, Badge } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { lt, toLocalInput } from "@/lib/format";
import { saveSubEvent, deleteSubEvent, addMealOption, deleteMealOption } from "../actions";

export const dynamic = "force-dynamic";

type SE = { id?: string; name?: unknown; startsAt?: Date; endsAt?: Date | null; venueName?: string | null; venueAddress?: string | null; mapUrl?: string | null; dressCode?: unknown; servesMeal?: boolean; rsvpDeadline?: Date | null; sortOrder?: number };

function SubEventForm({ studioId, eventId, se, disabled }: { studioId: string; eventId: string; se?: SE; disabled: boolean }) {
  return (
    <ActionForm action={saveSubEvent} submitLabel={se ? "Save" : "Add sub-event"} resetOnSuccess={!se}>
      <input type="hidden" name="studioId" value={studioId} />
      <input type="hidden" name="eventId" value={eventId} />
      {se?.id && <input type="hidden" name="subEventId" value={se.id} />}
      <fieldset disabled={disabled} className="space-y-3">
        <div><span className="label">Name</span><LocalizedInputs name="name" value={(se?.name ?? {}) as Record<string, string>} required /><FieldError name="name.en" /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Starts"><input name="startsAt" type="datetime-local" className="input" defaultValue={toLocalInput(se?.startsAt)} required /><FieldError name="startsAt" /></Field>
          <Field label="Ends"><input name="endsAt" type="datetime-local" className="input" defaultValue={toLocalInput(se?.endsAt)} /><FieldError name="endsAt" /></Field>
          <Field label="RSVP deadline"><input name="rsvpDeadline" type="datetime-local" className="input" defaultValue={toLocalInput(se?.rsvpDeadline)} /><FieldError name="rsvpDeadline" /></Field>
          <Field label="Venue"><input name="venueName" className="input" defaultValue={se?.venueName ?? ""} /></Field>
          <Field label="Address" className="sm:col-span-2"><input name="venueAddress" className="input" defaultValue={se?.venueAddress ?? ""} /></Field>
          <Field label="Map URL" className="sm:col-span-2"><input name="mapUrl" className="input" placeholder="https://maps…" defaultValue={se?.mapUrl ?? ""} /><FieldError name="mapUrl" /></Field>
          <Field label="Sort order"><input name="sortOrder" type="number" className="input" defaultValue={se?.sortOrder ?? 0} /></Field>
          <Field label="Dress code (en)" className="sm:col-span-2"><input name="dressCode" className="input" defaultValue={lt(se?.dressCode)} /></Field>
          <label className="flex items-end gap-1.5 pb-2 text-xs"><input type="checkbox" name="servesMeal" defaultChecked={se?.servesMeal ?? false} /> Serves a meal (asks for meal choice at RSVP)</label>
        </div>
      </fieldset>
    </ActionForm>
  );
}

export default async function SchedulePage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  const canEdit = can(p, "event.content.edit", { studioId, eventId });
  const subs = await prisma.subEvent.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }], include: { mealOptions: { orderBy: { sortOrder: "asc" } }, _count: { select: { invites: true } } } });

  return (
    <div className="space-y-4">
      {subs.map((se) => (
        <Card key={se.id} title={<span>{lt(se.name)} <span className="ml-2 font-normal text-neutral-400">{se._count.invites} invited</span>{se.servesMeal && <Badge tone="amber">meal</Badge>}</span>}
          actions={canEdit && <ActionButton action={deleteSubEvent} fields={{ studioId, eventId, subEventId: se.id }} confirm="Delete this sub-event and its pending invites?" className="btn-ghost btn-sm text-red-700">Delete</ActionButton>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <SubEventForm studioId={studioId} eventId={eventId} se={se} disabled={!canEdit} />
            <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-2 text-xs font-medium">Meal options</div>
              <ul className="mb-3 space-y-1 text-xs">
                {se.mealOptions.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>{lt(m.label)}{m.isKidsMeal && <Badge>kids</Badge>}</span>
                    {canEdit && <ActionButton action={deleteMealOption} fields={{ studioId, eventId, mealOptionId: m.id }} className="btn-ghost btn-sm text-red-700">×</ActionButton>}
                  </li>
                ))}
                {se.mealOptions.length === 0 && <li className="text-neutral-400">{se.servesMeal ? "No options yet — guests won't be able to pick a meal." : "Not serving a meal."}</li>}
              </ul>
              {canEdit && (
                <ActionForm action={addMealOption} submitLabel="Add" submitClassName="btn-secondary btn-sm" resetOnSuccess className="text-xs">
                  <input type="hidden" name="studioId" value={studioId} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="subEventId" value={se.id} />
                  <input name="label" className="input" placeholder="Vegetarian" required />
                  <label className="mt-1 flex items-center gap-1.5"><input type="checkbox" name="isKidsMeal" /> Kids meal</label>
                </ActionForm>
              )}
            </div>
          </div>
        </Card>
      ))}
      {canEdit && <Card title="Add sub-event"><SubEventForm studioId={studioId} eventId={eventId} disabled={false} /></Card>}
    </div>
  );
}
