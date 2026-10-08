"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/forms";
import { Field } from "@/components/ui";
import { slugify } from "@/lib/format";
import { createStudio } from "./actions";

export function CreateStudioForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  return (
    <ActionForm action={createStudio} submitLabel="Create studio" resetOnSuccess onSuccess={() => { setName(""); setSlug(""); setSlugTouched(false); }}>
      <div className="space-y-3">
        <Field label="Name" name="name">
          <input id="name" name="name" className="input" value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} required />
          <FieldError name="name" />
        </Field>
        <Field label="Slug" name="slug" help="Used for the studio's app hostname later.">
          <input id="slug" name="slug" className="input font-mono" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} required />
          <FieldError name="slug" />
        </Field>
        <Field label="Owner email" name="ownerEmail" help="Existing users are linked; otherwise an unclaimed account is created. They sign in with a magic link.">
          <input id="ownerEmail" name="ownerEmail" type="email" className="input" required />
          <FieldError name="ownerEmail" />
        </Field>
      </div>
    </ActionForm>
  );
}
