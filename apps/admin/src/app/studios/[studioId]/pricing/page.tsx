import { prisma } from "@hub/db";
import { can } from "@hub/shared";
import { getStudio } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Card, Table, Badge, Field } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { fmtCents } from "@/lib/format";
import { saveProduct, deleteProduct } from "../actions";

export const dynamic = "force-dynamic";

const KINDS = ["GALLERY_UNLOCK", "DIGITAL_PHOTO", "PRINT"] as const;

function ProductForm({ studioId, product }: { studioId: string; product?: { id: string; name: string; kind: string; priceCents: number; labSku: string | null; active: boolean } }) {
  return (
    <ActionForm action={saveProduct} submitLabel={product ? "Save" : "Add product"} resetOnSuccess={!product} className="grid gap-2 sm:grid-cols-[1fr_140px_110px_140px_auto] sm:items-end">
      <input type="hidden" name="studioId" value={studioId} />
      {product && <input type="hidden" name="productId" value={product.id} />}
      <Field label="Name" name={`name-${product?.id ?? "new"}`}><input name="name" className="input" defaultValue={product?.name ?? ""} required /><FieldError name="name" /></Field>
      <Field label="Kind"><select name="kind" className="input" defaultValue={product?.kind ?? "PRINT"}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      <Field label="Price (USD)"><input name="price" type="number" step="0.01" min={0} className="input" defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} required /><FieldError name="priceCents" /></Field>
      <Field label="Lab SKU" help="Placeholder until a print lab is connected."><input name="labSku" className="input font-mono" defaultValue={product?.labSku ?? ""} /></Field>
      <label className="mb-1 flex items-center gap-1.5 text-xs"><input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Active</label>
    </ActionForm>
  );
}

export default async function PricingPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const p = await requireAdmin(studioId);
  const studio = await getStudio(studioId);
  const canManage = can(p, "studio.manage", { studioId });
  const sheets = await prisma.priceSheet.findMany({ where: { studioId }, include: { products: { orderBy: [{ kind: "asc" }, { name: "asc" }] } } });

  return (
    <>
      <PageHeader title="Price sheets" description="Products sold through event sites. Prints map to lab SKUs; GALLERY_UNLOCK is the host package that unlocks full-res for every guest. Stripe and the print lab are placeholders for now." crumbs={[{ href: `/studios/${studioId}`, label: studio.name }, { label: "Price sheets" }]} />
      {sheets.length === 0 && <Card title="Default"><p className="mb-3 text-xs text-neutral-500">No price sheet yet; adding the first product creates one.</p>{canManage && <ProductForm studioId={studioId} />}</Card>}
      {sheets.map((s) => (
        <Card key={s.id} title={<>{s.name} <span className="ml-1 font-normal text-neutral-400">{s.currency.toUpperCase()}</span></>} padded={false} className="mb-4">
          <Table head={["Product", "Kind", "Price", "Lab SKU", "Status", ""]}>
            {s.products.map((pr) => (
              <tr key={pr.id}>
                <td colSpan={canManage ? 5 : 1} className={canManage ? "!py-2" : "font-medium"}>
                  {canManage ? <ProductForm studioId={studioId} product={pr} /> : pr.name}
                </td>
                {!canManage && <><td className="text-xs">{pr.kind}</td><td className="tabular-nums">{fmtCents(pr.priceCents, s.currency)}</td><td className="font-mono text-xs">{pr.labSku ?? "—"}</td><td>{pr.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</td></>}
                <td>{canManage && <ActionButton action={deleteProduct} fields={{ studioId, productId: pr.id }} confirm="Delete this product?" className="btn-ghost btn-sm text-red-700">Delete</ActionButton>}</td>
              </tr>
            ))}
            {s.products.length === 0 && <tr><td colSpan={6} className="text-neutral-500">No products.</td></tr>}
          </Table>
          {canManage && <div className="border-t border-neutral-200 p-3"><div className="mb-1 text-xs font-medium text-neutral-600">Add product</div><ProductForm studioId={studioId} /></div>}
        </Card>
      ))}
    </>
  );
}
