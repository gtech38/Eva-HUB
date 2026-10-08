"use client";

import { useEffect, useState } from "react";
import { smsSegments } from "@hub/shared/sms";
import { ActionForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { sendInvitations, previewInvite } from "./actions";

export function InviteComposer({ studioId, eventId, stats }: { studioId: string; eventId: string; stats: { recipients: number; withEmail: number; withPhone: number; pending: number; unsent: number } }) {
  const [intro, setIntro] = useState("");
  const [preview, setPreview] = useState<{ subject: string; text: string; smsBody: string; expires: string } | null>(null);
  const [channels, setChannels] = useState({ EMAIL: true, PHONE: false });
  const [scope, setScope] = useState<"all" | "pending">("all");
  const [onlyUnsent, setOnlyUnsent] = useState(true);

  useEffect(() => {
    const h = setTimeout(() => { previewInvite(studioId, eventId, intro).then(setPreview).catch(() => setPreview(null)); }, 300);
    return () => clearTimeout(h);
  }, [intro, studioId, eventId]);

  const n = Math.max(0, scope === "pending" ? stats.pending : stats.recipients);
  const estimate = `${channels.EMAIL ? `up to ${Math.min(n, stats.withEmail)} emails` : ""}${channels.EMAIL && channels.PHONE ? " + " : ""}${channels.PHONE ? `up to ${Math.min(n, stats.withPhone)} SMS` : ""}` || "nothing";

  return (
    <ActionForm action={sendInvitations} submitLabel={`Send (${estimate})`} submitClassName="btn-primary">
      <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <span className="label">Channels</span>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" name="channels" value="EMAIL" checked={channels.EMAIL} onChange={(e) => setChannels({ ...channels, EMAIL: e.target.checked })} /> Email ({stats.withEmail})</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="channels" value="PHONE" checked={channels.PHONE} onChange={(e) => setChannels({ ...channels, PHONE: e.target.checked })} /> SMS ({stats.withPhone})</label>
            </div>
            <p className="help">Every adult gets a personal link on every channel they have. Children are reached via their household.</p>
          </div>
          <div>
            <span className="label">Households</span>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} /> All ({stats.recipients} recipients)</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="pending" checked={scope === "pending"} onChange={() => setScope("pending")} /> Pending only ({stats.pending})</label>
            </div>
            <label className="mt-1 flex items-center gap-1.5 text-xs"><input type="checkbox" name="onlyUnsent" checked={onlyUnsent} onChange={(e) => setOnlyUnsent(e.target.checked)} /> Skip guests who already have an active link ({stats.unsent} without one)</label>
          </div>
          <Field label="Intro (English)" help="Optional. Replaces the default first line.">
            <textarea name="intro" className="input min-h-[70px]" value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Join us in Dallas this December for three days of celebration." maxLength={1000} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">
            <div className="mb-1 font-medium text-neutral-700">Email preview</div>
            {preview ? <><div className="mb-1"><span className="text-neutral-500">Subject:</span> {preview.subject}</div><pre className="whitespace-pre-wrap font-sans text-[12px] text-neutral-700">{preview.text}</pre></> : <div className="text-neutral-400">Loading…</div>}
          </div>
          <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">
            <div className="mb-1 flex items-center justify-between font-medium text-neutral-700"><span>SMS preview</span>{preview && <span className="font-normal text-neutral-500">{preview.smsBody.length} chars · {smsSegments(preview.smsBody.replace("<token>", "x".repeat(43)))} segment(s)</span>}</div>
            {preview ? <div className="text-neutral-700">{preview.smsBody}</div> : <div className="text-neutral-400">Loading…</div>}
          </div>
          {preview && <p className="text-[11px] text-neutral-400">Links expire {new Date(preview.expires).toLocaleDateString()} (event date + 90 days, or 180 days from now if no date).</p>}
        </div>
      </div>
    </ActionForm>
  );
}
