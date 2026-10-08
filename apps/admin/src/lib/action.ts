import { z, type ZodError } from "zod";

export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  data?: unknown;
} | null;

export function fromZod(err: ZodError): ActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const i of err.issues) {
    const k = i.path.join(".") || "_";
    (fieldErrors[k] ??= []).push(i.message);
  }
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}

function isNextControlFlow(e: unknown) {
  const d = (e as { digest?: unknown })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND") || d.startsWith("NEXT_HTTP_ERROR"));
}

/**
 * Wrap a server action body: Zod errors become field errors, other errors become
 * a message, Next redirects pass through.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function act(fn: () => Promise<any>): Promise<ActionState> {
  try {
    const r = (await fn()) as ActionState | void;
    return r ?? { ok: true };
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError") return fromZod(e as ZodError);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[action]", e);
    return { ok: false, error: msg };
  }
}

/** FormData → plain object; repeated keys become arrays; checkboxes come back as "on". */
export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k in out) {
      const cur = out[k];
      out[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else out[k] = v;
  }
  return out;
}

export const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true" || fd.get(k) === "1";
export const opt = (fd: FormData, k: string) => { const v = str(fd, k); return v === "" ? null : v; };
export const localized = (fd: FormData, k: string) => {
  const o: Record<string, string> = {};
  for (const l of ["en", "te", "hi"]) { const v = str(fd, `${k}.${l}`); if (v) o[l] = v; }
  return o;
};

/** Email check that accepts local dev addresses like admin@localhost (zod's .email() needs a TLD). */
export const EmailSchema = (msg = "Enter a valid email address") => z.string().trim().regex(/^[^\s@]+@[^\s@]+$/, msg);
