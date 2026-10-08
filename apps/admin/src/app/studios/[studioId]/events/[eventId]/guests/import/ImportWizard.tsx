"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import type { ActionState } from "@/lib/action";
import { dryRunImport, confirmImport, type ImportPreview } from "../actions";

export function ImportWizard({ studioId, eventId, guestsHref }: { studioId: string; eventId: string; guestsHref: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [dry, dryAction] = useActionState(async (prev: ActionState, fd: FormData) => { const r = await dryRunImport(prev, fd); if (r?.ok) setPreview(r.data as ImportPreview); return r; }, null);
  const [done, confirmAction] = useActionState(async (prev: ActionState, fd: FormData) => { const r = await confirmImport(prev, fd); if (r?.ok) setTimeout(() => router.push(guestsHref), 800); return r; }, null);

  return (
    <div className="space-y-4">
      <form action={dryAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
        <div><label className="label">CSV file</label><input type="file" name="file" accept=".csv,text/csv" className="text-xs" required /></div>
        <SubmitButton className="btn-secondary" pendingText="Checking…">Preview (dry run)</SubmitButton>
        {dry && !dry.ok && <span className="text-xs text-red-700">{dry.error}</span>}
      </form>

      {preview && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <span><b>{preview.rows.length}</b> rows</span>
            <span><b>{preview.households}</b> households</span>
            <Badge tone="green">{preview.valid} valid</Badge>
            {preview.invalid > 0 && <Badge tone="red">{preview.invalid} invalid</Badge>}
            <span className="text-neutral-400">columns: {preview.headers.join(", ")}</span>
          </div>
          <div className="max-h-[420px] overflow-auto rounded border border-neutral-200">
            <table className="table">
              <thead><tr><th>#</th><th>Household</th><th>Name</th><th>Email</th><th>Phone</th><th>Child</th><th>+1</th><th>Sub-events</th><th>Issues</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? "bg-red-50" : ""}>
                    <td className="text-neutral-400">{r.line}</td>
                    <td>{r.household}</td>
                    <td>{[r.firstName, r.lastName].filter(Boolean).join(" ")}</td>
                    <td className="text-xs">{r.email ?? ""}</td>
                    <td className="text-xs">{r.phone ?? ""}</td>
                    <td>{r.isChild ? "yes" : ""}</td>
                    <td>{r.plusOnes || ""}</td>
                    <td className="text-xs">{r.subEvents.join(", ")}</td>
                    <td className="text-xs">{r.errors.map((e, i) => <div key={i} className="text-red-700">{e}</div>)}{r.warnings.map((w, i) => <div key={i} className="text-amber-700">{w}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={confirmAction} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="rows" value={JSON.stringify(preview.rows)} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="skipInvalid" defaultChecked={preview.invalid > 0} /> Skip invalid rows</label>
            <SubmitButton className="btn-primary" pendingText="Importing…" disabled={preview.valid === 0 || !!done?.ok}>Import {preview.valid} guests</SubmitButton>
            {done && !done.ok && <span className="text-xs text-red-700">{done.error}</span>}
            {done?.ok && <span className="text-xs text-green-700">{done.message} Redirecting…</span>}
          </form>
        </div>
      )}
    </div>
  );
}
