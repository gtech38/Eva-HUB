"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const StateCtx = createContext<ActionState>(null);

export function useActionResult() { return useContext(StateCtx); }

export function FieldError({ name }: { name: string }) {
  const s = useContext(StateCtx);
  const errs = s?.fieldErrors?.[name];
  if (!errs?.length) return null;
  return <>{errs.map((e, i) => <p key={i} className="error">{e}</p>)}</>;
}

export function SubmitButton({ children, className = "btn-primary", pendingText = "Saving…", disabled, name, value, formAction, title }: { children: ReactNode; className?: string; pendingText?: string; disabled?: boolean; name?: string; value?: string; formAction?: (fd: FormData) => void | Promise<void>; title?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending || disabled} name={name} value={value} formAction={formAction} title={title}>{pending ? pendingText : children}</button>;
}

/**
 * Form wired to a server action returning ActionState. Shows a global error /
 * success line, exposes field errors via <FieldError name>, resets on success
 * when `resetOnSuccess` is set.
 */
export function ActionForm({ action, children, className = "", submitLabel = "Save", submitClassName = "btn-primary", resetOnSuccess = false, footer, hideSubmit = false, onSuccess }: {
  action: ServerAction; children: ReactNode; className?: string; submitLabel?: ReactNode; submitClassName?: string; resetOnSuccess?: boolean; footer?: ReactNode; hideSubmit?: boolean; onSuccess?: (s: NonNullable<ActionState>) => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <StateCtx.Provider value={state}>
      <form ref={ref} action={formAction} className={className}>
        {children}
        {state && !state.ok && state.error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
        {state?.ok && state.message && <p className="mt-3 rounded border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>}
        {!hideSubmit && (
          <div className="mt-3 flex items-center gap-2">
            <SubmitButton className={submitClassName}>{submitLabel}</SubmitButton>
            {footer}
          </div>
        )}
      </form>
    </StateCtx.Provider>
  );
}

/** A single button that invokes a server action (with optional hidden fields + confirm). */
export function ActionButton({ action, children, className = "btn-secondary btn-sm", confirm, fields = {}, pendingText = "…", title, disabled }: {
  action: ServerAction; children: ReactNode; className?: string; confirm?: string; fields?: Record<string, string>; pendingText?: string; title?: string; disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start"
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton className={className} pendingText={pendingText} title={title} disabled={disabled}>{children}</SubmitButton>
      {state && !state.ok && state.error && <span className="mt-1 max-w-[260px] text-[11px] text-red-700">{state.error}</span>}
      {state?.ok && state.message && <span className="mt-1 text-[11px] text-green-700">{state.message}</span>}
    </form>
  );
}
