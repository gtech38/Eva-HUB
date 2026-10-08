import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Field, Badge } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { lt, fmtCents } from "@/lib/format";
import { saveRegistryItem, deleteRegistryItem, saveCashFund, deleteCashFund } from "../actions";

export const dynamic = "force-dynamic";

function ItemForm({ studioId, eventId, item, disabled }: { studioId: string; eventId: string; item?: { id: string; title: unknown; storeName: string | null; url: string; imageUrl: string | null; quantity: number }; disabled: boolean }) {
  return (
    <ActionForm action={saveRegistryItem} submitLabel={item ? "Save" : "Add item"} resetOnSuccess={!item} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_1fr_70px] sm:items-end">
      <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}
      <fieldset disabled={disabled} className="contents">
        <Field label="Title"><input name="title" className="input" defaultValue={lt(item?.title)} required /><FieldError name="title" /></Field>
        <Field label="Store"><input name="storeName" className="input" defaultValue={item?.storeName ?? ""} placeholder="Amazon" /></Field>
        <Field label="URL"><input name="url" className="input" defaultValue={item?.url ?? ""} placeholder="https://" required /><FieldError name="url" /></Field>
        <Field label="Image URL"><input name="imageUrl" className="input" defaultValue={item?.imageUrl ?? ""} placeholder="https://" /><FieldError name="imageUrl" /></Field>
        <Field label="Qty"><input name="quantity" type="number" min={1} className="input" defaultValue={item?.quantity ?? 1} /><FieldError name="quantity" /></Field>
      </fieldset>
    </ActionForm>
  );
}

function FundForm({ studioId, eventId, fund, disabled }: { studioId: string; eventId: string; fund?: { id: string; title: unknown; kind: string; externalHandle: string | null; goalCents: number | null }; disabled: boolean }) {
  return (
    <ActionForm action={saveCashFund} submitLabel={fund ? "Save" : "Add fund"} resetOnSuccess={!fund} className="grid gap-2 sm:grid-cols-[1fr_130px_1fr_120px] sm:items-end">
      <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
      {fund && <input type="hidden" name="fundId" value={fund.id} />}
      <fieldset disabled={disabled} className="contents">
        <Field label="Title"><input name="title" className="input" defaultValue={lt(fund?.title)} placeholder="Honeymoon fund" required /><FieldError name="title" /></Field>
        <Field label="Kind"><select name="kind" className="input" defaultValue={fund?.kind ?? "EXTERNAL"}><option value="EXTERNAL">EXTERNAL (Venmo/Zelle)</option><option value="STRIPE">STRIPE</option></select></Field>
        <Field label="External handle" help="Displayed only; not tracked."><input name="externalHandle" className="input" defaultValue={fund?.externalHandle ?? ""} placeholder="@venmo-handle" /><FieldError name="externalHandle" /></Field>
        <Field label="Goal (USD)"><input name="goal" type="number" step="0.01" min={0} className="input" defaultValue={fund?.goalCents != null ? (fund.goalCents / 100).toFixed(2) : ""} /><FieldError name="goalCents" /></Field>
      </fieldset>
    </ActionForm>
  );
}

export default async function RegistryPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  const canEdit = can(p, "registry.manage", { studioId, eventId });
  const [items, funds] = await Promise.all([
    prisma.registryItem.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { claims: true } } } }),
    prisma.cashFund.findMany({ where: { eventId } }),
  ]);
  const contributions = funds.length ? await prisma.contribution.groupBy({ by: ["cashFundId"], _sum: { amountCents: true }, where: { cashFundId: { in: funds.map((f) => f.id) } } }) : [];

  return (
    <div className="space-y-4">
      <Card title="Registry items" padded={false}>
        <ul className="divide-y divide-neutral-100">
          {items.map((it) => (
            <li key={it.id} className="flex items-end gap-2 px-4 py-2">
              <div className="flex-1"><ItemForm studioId={studioId} eventId={eventId} item={it} disabled={!canEdit} /></div>
              <div className="pb-3 text-xs text-neutral-500">{it._count.claims} claimed</div>
              {canEdit && <div className="pb-2"><ActionButton action={deleteRegistryItem} fields={{ studioId, eventId, itemId: it.id }} confirm="Delete this registry item?" className="btn-ghost btn-sm text-red-700">Delete</ActionButton></div>}
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-3 text-xs text-neutral-500">No items yet.</li>}
        </ul>
        {canEdit && <div className="border-t border-neutral-200 p-4"><div className="mb-1 text-xs font-medium text-neutral-600">Add item</div><ItemForm studioId={studioId} eventId={eventId} disabled={false} /></div>}
      </Card>
      <Card title="Cash funds" padded={false}>
        <ul className="divide-y divide-neutral-100">
          {funds.map((f) => {
            const sum = contributions.find((c) => c.cashFundId === f.id)?._sum.amountCents ?? 0;
            return (
              <li key={f.id} className="px-4 py-2">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  {f.kind === "STRIPE" ? <Badge tone="amber">Stripe not connected (placeholder)</Badge> : <Badge>external</Badge>}
                  {f.kind === "STRIPE" && <span className="text-neutral-500">Raised {fmtCents(sum)}{f.goalCents ? ` of ${fmtCents(f.goalCents)}` : ""}</span>}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1"><FundForm studioId={studioId} eventId={eventId} fund={f} disabled={!canEdit} /></div>
                  {canEdit && <div className="pb-2"><ActionButton action={deleteCashFund} fields={{ studioId, eventId, fundId: f.id }} confirm="Delete this fund?" className="btn-ghost btn-sm text-red-700">Delete</ActionButton></div>}
                </div>
              </li>
            );
          })}
          {funds.length === 0 && <li className="px-4 py-3 text-xs text-neutral-500">No cash funds.</li>}
        </ul>
        {canEdit && <div className="border-t border-neutral-200 p-4"><div className="mb-1 text-xs font-medium text-neutral-600">Add fund</div><FundForm studioId={studioId} eventId={eventId} disabled={false} /></div>}
      </Card>
    </div>
  );
}
