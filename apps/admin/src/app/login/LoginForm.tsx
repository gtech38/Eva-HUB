"use client";

import { ActionForm, FieldError } from "@/components/forms";
import { requestMagicLink } from "./actions";

export function LoginForm() {
  return (
    <ActionForm action={requestMagicLink} submitLabel="Email me a sign-in link" submitClassName="btn-primary w-full justify-center">
      <label className="label" htmlFor="email">Email</label>
      <input id="email" name="email" type="email" className="input" placeholder="you@studio.com" autoComplete="email" autoFocus required />
      <FieldError name="email" />
    </ActionForm>
  );
}
