import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent, getStudio, THEMES } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Field, LocalizedInputs } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { ThemePicker } from "@/components/ThemePicker";
import { fmtDateTime, toDateInput } from "@/lib/format";
import { updateEventSettings, purgeFaceIndexNow } from "../actions";

export const dynamic = "force-dynamic";

export default async function EventSettingsPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  const [studio, event] = await Promise.all([getStudio(studioId), getEvent(studioId, eventId)]);
  const canEdit = can(p, "event.settings", { studioId, eventId });
  const faces = await prisma.face.count({ where: { eventId } });
  const title = (event.title ?? {}) as Record<string, string>;
  const overrides = (event.themeOverrides ?? {}) as { monogram?: string | null };
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Event settings">
        {!canEdit && <p className="mb-3 text-xs text-amber-800">Read-only: only studio owners can change event settings.</p>}
        <ActionForm action={updateEventSettings} submitLabel="Save settings">
          <input type="hidden" name="studioId" value={studioId} />
          <input type="hidden" name="eventId" value={eventId} />
          <fieldset disabled={!canEdit} className="space-y-4">
            <div>
              <span className="label">Title</span>
              <LocalizedInputs name="title" value={title} required />
              <FieldError name="title.en" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Slug" name="slug" help={`${event.slug}.${rootDomain} — changing it moves the hostname.`}><input id="slug" name="slug" className="input font-mono" defaultValue={event.slug} required /><FieldError name="slug" /></Field>
              <Field label="Date" name="startsOn"><input id="startsOn" name="startsOn" type="date" className="input" defaultValue={toDateInput(event.startsOn)} /><FieldError name="startsOn" /></Field>
              <Field label="Timezone" name="timezone"><input id="timezone" name="timezone" className="input" defaultValue={event.timezone} /><FieldError name="timezone" /></Field>
              <Field label="Status" name="status" help="LIVE makes the site visible to invited guests.">
                <select id="status" name="status" className="input" defaultValue={event.status}>{["DRAFT", "LIVE", "COMPLETED", "ARCHIVED"].map((s) => <option key={s}>{s}</option>)}</select>
                <FieldError name="status" />
              </Field>
              <Field label="Monogram" name="monogram" help="Shown on the sign-in screen and hero."><input id="monogram" name="monogram" className="input" defaultValue={overrides.monogram ?? ""} maxLength={12} /><FieldError name="monogram" /></Field>
              <Field label="Default locale" name="defaultLocale">
                <select id="defaultLocale" name="defaultLocale" className="input" defaultValue={event.defaultLocale}><option value="en">English</option><option value="te">Telugu</option><option value="hi">Hindi</option></select>
                <FieldError name="defaultLocale" />
              </Field>
            </div>
            <div>
              <span className="label">Enabled locales</span>
              <div className="flex gap-4 text-xs">
                {([["en", "English"], ["te", "Telugu"], ["hi", "Hindi"]] as const).map(([l, label]) => <label key={l} className="flex items-center gap-1.5"><input type="checkbox" name="enabledLocales" value={l} defaultChecked={event.enabledLocales.includes(l)} /> {label}</label>)}
              </div>
              <FieldError name="enabledLocales" />
            </div>
            <div>
              <span className="label">Theme</span>
              <ThemePicker themes={THEMES} name="theme" defaultValue={event.theme} />
              <FieldError name="theme" />
            </div>
            <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-2 text-xs font-medium">Face search (biometric)</div>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="faceSearchEnabled" defaultChecked={event.faceSearchEnabled} /> Face search enabled for this event</label>
              <div className="mt-3 max-w-xs">
                <Field label="Retention override (days)" name="faceIndexRetentionDays" help={`Blank = studio default (${studio.faceIndexRetentionDays}d). 30–730. Admin-only; hosts can't change it.`}>
                  <input id="faceIndexRetentionDays" name="faceIndexRetentionDays" type="number" min={30} max={730} className="input" defaultValue={event.faceIndexRetentionDays ?? ""} placeholder={String(studio.faceIndexRetentionDays)} />
                  <FieldError name="faceIndexRetentionDays" />
                </Field>
              </div>
            </div>
          </fieldset>
        </ActionForm>
      </Card>
      <div className="space-y-4">
        <Card title="Face index">
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
            <dt className="text-neutral-500">Face rows</dt><dd className="tabular-nums">{faces}</dd>
            <dt className="text-neutral-500">Published</dt><dd>{fmtDateTime(event.galleryPublishedAt)}</dd>
            <dt className="text-neutral-500">Purge at</dt><dd>{fmtDateTime(event.faceIndexPurgeAt)}</dd>
            <dt className="text-neutral-500">Purged</dt><dd>{fmtDateTime(event.faceIndexPurgedAt)}</dd>
          </dl>
          {canEdit && <div className="mt-3"><ActionButton action={purgeFaceIndexNow} fields={{ studioId, eventId }} className="btn-danger btn-sm" confirm="Queue a purge of all face embeddings and clusters for this event? Guests will need to search again; saved matches are kept.">Purge face index now</ActionButton></div>}
          <p className="help">Queues a PURGE_FACE_INDEX job and writes an audit entry.</p>
        </Card>
      </div>
    </div>
  );
}
