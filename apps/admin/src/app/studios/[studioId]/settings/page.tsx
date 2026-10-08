import { getStudio } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { can } from "@hub/shared";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm, FieldError } from "@/components/forms";
import { updateStudioSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function StudioSettings({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const p = await requireAdmin(studioId);
  const studio = await getStudio(studioId);
  const brand = (studio.brandJson ?? {}) as { credit?: string; url?: string; logoText?: string };
  const canManage = can(p, "studio.manage", { studioId });

  return (
    <>
      <PageHeader title="Studio settings" crumbs={[{ href: `/studios/${studioId}`, label: studio.name }, { label: "Settings" }]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Brand and retention">
          {!canManage && <p className="mb-3 text-xs text-amber-800">Read-only: only studio owners can change settings.</p>}
          <ActionForm action={updateStudioSettings} submitLabel="Save settings">
            <input type="hidden" name="studioId" value={studioId} />
            <fieldset disabled={!canManage} className="space-y-3">
              <Field label="Studio name" name="name"><input id="name" name="name" className="input" defaultValue={studio.name} required /><FieldError name="name" /></Field>
              <Field label="Footer credit" name="credit" help="Shown in every event site footer. Hosts can't remove it."><input id="credit" name="credit" className="input" defaultValue={brand.credit ?? `Photography by ${studio.name}`} /><FieldError name="credit" /></Field>
              <Field label="Credit link" name="url"><input id="url" name="url" className="input" placeholder="https://" defaultValue={brand.url ?? ""} /><FieldError name="url" /></Field>
              <Field label="Logo text" name="logoText" help="Short monogram used where no logo image is set."><input id="logoText" name="logoText" className="input max-w-[120px]" defaultValue={brand.logoText ?? ""} maxLength={6} /><FieldError name="logoText" /></Field>
              <Field label="Face index retention (days)" name="faceIndexRetentionDays" help="Admin-only. 30–730 days; there is no 'keep forever'. Changes are audited and purge dates are recomputed for events using the default.">
                <input id="faceIndexRetentionDays" name="faceIndexRetentionDays" type="number" min={30} max={730} className="input max-w-[120px]" defaultValue={studio.faceIndexRetentionDays} required />
                <FieldError name="faceIndexRetentionDays" />
              </Field>
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Payments (Stripe Connect)">
          <p className="mb-3 text-xs text-neutral-500">Stripe isn't connected in this environment. Connect later; galleries can be unlocked manually (comped) from each event's gallery page in the meantime.</p>
          <div className="space-y-3 opacity-60">
            <Field label="Stripe account ID"><input className="input" disabled value={studio.stripeAccountId ?? ""} placeholder="acct_… (connect later)" readOnly /></Field>
            <Field label="Payout schedule"><input className="input" disabled value="" placeholder="Managed in Stripe" readOnly /></Field>
            <button className="btn-secondary" disabled>Connect Stripe</button>
          </div>
        </Card>
      </div>
    </>
  );
}
