import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: Array<{ href?: string; label: ReactNode }> }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {crumbs && crumbs.length > 0 && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-neutral-500">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-neutral-300">/</span>}
                {c.href ? <Link href={c.href} className="text-neutral-500 hover:text-neutral-900 hover:underline">{c.label}</Link> : <span className="text-neutral-700">{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2.5">
          <h2>{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  neutral: "border-neutral-200 bg-neutral-100 text-neutral-700",
  green: "border-green-200 bg-green-50 text-green-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  purple: "border-purple-200 bg-purple-50 text-purple-800",
};

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: keyof typeof TONES; title?: string }) {
  return <span className={`badge ${TONES[tone] ?? TONES.neutral}`} title={title}>{children}</span>;
}

export const STATUS_TONE: Record<string, keyof typeof TONES> = {
  DRAFT: "neutral", LIVE: "green", COMPLETED: "blue", ARCHIVED: "amber",
  QUEUED: "neutral", RUNNING: "blue", SUCCEEDED: "green", FAILED: "red", DEAD: "red",
  UPLOADING: "neutral", UPLOADED: "blue", PROCESSING: "amber", READY: "green",
  PENDING: "neutral", ATTENDING: "green", DECLINED: "red",
  SENT: "green", DELIVERED: "green", BOUNCED: "red", SUPPRESSED: "amber", OPENED: "green", CLICKED: "green",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>;
}

export function Field({ label, name, help, children, error, className = "" }: { label: ReactNode; name?: string; help?: ReactNode; children: ReactNode; error?: string[] | string; className?: string }) {
  const errs = Array.isArray(error) ? error : error ? [error] : [];
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>{label}</label>
      {children}
      {errs.map((e, i) => <p key={i} className="error">{e}</p>)}
      {help && errs.length === 0 && <p className="help">{help}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-neutral-300 px-4 py-8 text-center text-xs text-neutral-500">{children}</div>;
}

export function Table({ head, children, className = "" }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="table">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

/** Three inputs for a LocalizedText field. */
export function LocalizedInputs({ name, value, textarea = false, required = false }: { name: string; value?: Record<string, string | undefined> | null; textarea?: boolean; required?: boolean }) {
  const locales: Array<["en" | "te" | "hi", string]> = [["en", "English"], ["te", "Telugu"], ["hi", "Hindi"]];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {locales.map(([l, label]) => (
        <div key={l}>
          <span className="mb-0.5 block text-[11px] text-neutral-500">{label}{l === "en" && required ? " *" : ""}</span>
          {textarea
            ? <textarea name={`${name}.${l}`} className="input min-h-[60px]" defaultValue={value?.[l] ?? ""} />
            : <input name={`${name}.${l}`} className="input" defaultValue={value?.[l] ?? ""} required={l === "en" && required} />}
        </div>
      ))}
    </div>
  );
}
