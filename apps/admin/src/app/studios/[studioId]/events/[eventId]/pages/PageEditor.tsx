"use client";

import { ActionForm, FieldError } from "@/components/forms";
import { Field, LocalizedInputs } from "@/components/ui";
import { savePage } from "../actions";

export type FieldSpec = { key: string; kind: "localized" | "json" | "string"; long?: boolean };

export function PageEditor({ studioId, eventId, type, spec, content, enabled, sortOrder, jsonHints, disabled }: {
  studioId: string; eventId: string; type: string; spec: FieldSpec[]; content: Record<string, unknown>; enabled: boolean; sortOrder: number; jsonHints: Record<string, string>; disabled: boolean;
}) {
  return (
    <ActionForm action={savePage} submitLabel="Save page" footer={<span className="text-[11px] text-neutral-400">{type}</span>}>
      <input type="hidden" name="studioId" value={studioId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="type" value={type} />
      <fieldset disabled={disabled} className="space-y-3">
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" name="enabled" defaultChecked={enabled} /> Enabled</label>
          <label className="flex items-center gap-1.5">Sort order <input type="number" name="sortOrder" className="input w-16" defaultValue={sortOrder} /></label>
        </div>
        {spec.map((f) => {
          if (f.kind === "localized") {
            return (
              <div key={f.key}>
                <span className="label">{f.key}</span>
                <LocalizedInputs name={`f.${f.key}`} value={(content[f.key] ?? {}) as Record<string, string>} textarea={f.long} />
                <FieldError name={f.key} />
              </div>
            );
          }
          if (f.kind === "json") {
            const v = content[f.key];
            return (
              <Field key={f.key} label={<>{f.key} <span className="font-normal text-neutral-400">(JSON array)</span></>} help={jsonHints[f.key] ? <code className="break-all">{jsonHints[f.key]}</code> : undefined}>
                <textarea name={`f.${f.key}`} className="input min-h-[90px] font-mono text-xs" defaultValue={Array.isArray(v) && v.length ? JSON.stringify(v, null, 2) : ""} placeholder="[]" />
                <FieldError name={f.key} />
              </Field>
            );
          }
          return (
            <Field key={f.key} label={f.key}>
              <input name={`f.${f.key}`} className="input font-mono text-xs" defaultValue={(content[f.key] as string | null) ?? ""} />
              <FieldError name={f.key} />
            </Field>
          );
        })}
      </fieldset>
    </ActionForm>
  );
}
