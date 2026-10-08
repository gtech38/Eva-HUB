import { prisma } from "@hub/db";
import { can, PAGE_PATHS } from "@hub/shared";
import { getEvent, PAGE_ORDER } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card } from "@/components/ui";
import { PageEditor, type FieldSpec } from "./PageEditor";
import { z } from "zod";
import { PAGE_SCHEMAS } from "@hub/shared";

export const dynamic = "force-dynamic";

function unwrap(def: z.ZodTypeAny): z.ZodTypeAny {
  let d = def;
  for (let i = 0; i < 5; i++) {
    if (d instanceof z.ZodDefault || d instanceof z.ZodOptional || d instanceof z.ZodNullable) d = d._def.innerType;
    else break;
  }
  return d;
}

/** Derive a flat field list from the Zod page schema so the editor tracks the contract. */
function specFor(type: keyof typeof PAGE_SCHEMAS): FieldSpec[] {
  const shape = (PAGE_SCHEMAS[type] as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape).map(([key, def]) => {
    const inner = unwrap(def);
    if (inner instanceof z.ZodArray) return { key, kind: "json" as const };
    if (inner instanceof z.ZodRecord) return { key, kind: "localized" as const, long: ["story", "intro", "airport"].includes(key) };
    return { key, kind: "string" as const };
  });
}

const JSON_HINTS: Record<string, string> = {
  hotels: '[{"name":"Hotel X","url":"https://…","note":{"en":"Room block until Nov 1"}}]',
  items: '[{"q":{"en":"Can I bring kids?"},"a":{"en":"Yes."}}]',
  members: '[{"name":"Asha","role":{"en":"Maid of honour"},"photoKey":null,"blurb":{"en":"…"}}]',
  photoKeys: '["s/<studio>/e/<event>/site/…jpg"]',
};

export default async function PagesPage({ params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const p = await requireAdmin(studioId);
  await getEvent(studioId, eventId);
  const canEdit = can(p, "event.content.edit", { studioId, eventId });
  const pages = await prisma.eventPage.findMany({ where: { eventId } });

  return (
    <>
      {!canEdit && <p className="mb-3 text-xs text-amber-800">Read-only.</p>}
      <p className="mb-4 text-xs text-neutral-500">Each page type has a typed content schema. Text fields take all three locales; list fields are edited as JSON and validated on save. Disabled pages are hidden from the site nav. Sort order controls nav position.</p>
      <div className="grid gap-4 xl:grid-cols-2">
        {PAGE_ORDER.map((type) => {
          const row = pages.find((x) => x.type === type);
          const content = (row?.content ?? {}) as Record<string, unknown>;
          return (
            <Card key={type} title={<span>{type} <span className="ml-1 font-mono text-[11px] font-normal text-neutral-400">{PAGE_PATHS[type]}</span>{!row && <span className="ml-2 text-[11px] font-normal text-neutral-400">(not created yet)</span>}</span>}>
              <PageEditor studioId={studioId} eventId={eventId} type={type} spec={specFor(type)} content={content} enabled={row?.enabled ?? false} sortOrder={row?.sortOrder ?? PAGE_ORDER.indexOf(type)} jsonHints={JSON_HINTS} disabled={!canEdit} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
