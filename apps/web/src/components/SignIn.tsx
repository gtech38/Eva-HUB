"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import type { Locale } from "@hub/shared/i18n";
import { requestSignIn, type SignInState } from "@/app/sites/[slug]/auth/actions";
import { inviteNotice } from "@/lib/inviteNotice";

type Props = {
  title: string;
  monogram: string;
  locale: Locale;
  strings: { signIn: string; signInHelp: string; sending: string };
  divider: React.ReactNode;
};

export function SignIn({ title, monogram, locale, strings, divider }: Props) {
  const [state, action, pending] = useActionState<SignInState, FormData>(requestSignIn, null);
  // Set by /i/[token] when an invitation link can no longer be used.
  const expired = inviteNotice(useSearchParams(), locale);
  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-2 py-10 text-center sm:py-16">
      {monogram && <div className="font-display text-5xl text-accent">{monogram}</div>}
      <h1 className="mt-4 font-display text-4xl leading-tight">{title}</h1>
      {divider}
      {expired && !state && (
        <h2 role="alert" className="mb-6 font-display text-2xl">
          {expired}
        </h2>
      )}
      {state ? (
        <p role="status" className="card px-6 py-5 text-base">
          {state.message}
        </p>
      ) : (
        <form action={action} className="w-full space-y-4 text-left">
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">{strings.signInHelp}</span>
            <input
              name="contact"
              type="text"
              inputMode="email"
              autoComplete="email tel"
              required
              className="input"
              placeholder="name@example.com · +1 512 555 0101"
            />
          </label>
          <button type="submit" className="btn w-full" disabled={pending}>
            {pending ? strings.sending : strings.signIn}
          </button>
        </form>
      )}
    </section>
  );
}
