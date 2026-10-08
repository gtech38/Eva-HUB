"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, FieldError } from "@/components/forms";
import { Field } from "@/components/ui";
import { slugify } from "@/lib/format";
import { createEvent, searchStudioContacts } from "../../actions";
import { ThemePicker } from "@/components/ThemePicker";


type Contact = { id: string; name: string; contact: string };

export function NewEventForm({ studioId, themes, kinds, rootDomain }: { studioId: string; themes: Array<{ key: string; label: string; swatch: string[]; suits?: string }>; kinds: Array<{ key: string; label: string }>; rootDomain: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Contact | null>(null);

  useEffect(() => {
    if (picked || q.trim().length < 2) { setResults([]); return; }
    const h = setTimeout(() => { searchStudioContacts(studioId, q).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q, picked, studioId]);

  return (
    <ActionForm action={createEvent} submitLabel="Create event" onSuccess={(s) => { const id = (s.data as { eventId?: string } | undefined)?.eventId; if (id) router.push(`/studios/${studioId}/events/${id}`); }}>
      <input type="hidden" name="studioId" value={studioId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" name="title" help="Shown as the English title; add Telugu/Hindi in settings later." className="sm:col-span-2">
          <input id="title" name="title" className="input" value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} placeholder="Priya & Arjun" required />
          <FieldError name="title" />
        </Field>
        <Field label="Slug" name="slug" help={`Site: ${slug || "<slug>"}.${rootDomain}`}>
          <input id="slug" name="slug" className="input font-mono" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} required />
          <FieldError name="slug" />
        </Field>
        <Field label="Date" name="startsOn"><input id="startsOn" name="startsOn" type="date" className="input" /><FieldError name="startsOn" /></Field>
        <Field label="Timezone" name="timezone"><input id="timezone" name="timezone" className="input" defaultValue="America/Chicago" /><FieldError name="timezone" /></Field>
        <Field label="Kind of event" name="kind" help="Themes read this to choose their wording (e.g. no 'getting married' on a birthday).">
          <select id="kind" name="kind" className="input" defaultValue="WEDDING">{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          <FieldError name="kind" />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Theme</span>
          <ThemePicker themes={themes} name="theme" defaultValue="LUXURY" />
          <FieldError name="theme" />
        </div>
        <div className="sm:col-span-2 rounded border border-neutral-200 bg-neutral-50 p-3">
          <div className="mb-1 text-xs font-medium text-neutral-700">Host</div>
          <p className="mb-2 text-xs text-neutral-500">Pick an existing studio contact, or type a new email. The host gets HOST membership and signs in with a magic link from the event site.</p>
          {picked ? (
            <div className="flex items-center justify-between rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs">
              <span><span className="font-medium">{picked.name}</span> <span className="text-neutral-500">{picked.contact}</span></span>
              <input type="hidden" name="hostUserId" value={picked.id} />
              <button type="button" className="underline" onClick={() => setPicked(null)}>change</button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" placeholder="Search contacts by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded border border-neutral-200 bg-white shadow">
                  {results.map((r) => <li key={r.id}><button type="button" className="flex w-full justify-between px-2 py-1.5 text-left text-xs hover:bg-neutral-50" onClick={() => { setPicked(r); setQ(""); }}><span className="font-medium">{r.name}</span><span className="text-neutral-500">{r.contact}</span></button></li>)}
                </ul>
              )}
              <div className="mt-2 text-[11px] text-neutral-500">or new host email</div>
              <input name="hostEmail" type="email" className="input" placeholder="host@example.com" />
              <FieldError name="hostEmail" />
            </div>
          )}
        </div>
      </div>
    </ActionForm>
  );
}
