import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, intro, children }: { eyebrow?: string; title: string; intro?: string; children?: ReactNode }) {
  return (
    <header className="mb-8 text-center">
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h1 className="font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
      {intro && <p className="mx-auto mt-4 max-w-2xl text-base text-muted">{intro}</p>}
      {children}
    </header>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="card mx-auto max-w-lg px-6 py-10 text-center">
      <p className="font-display text-2xl">{title}</p>
      {body && <p className="mt-2 text-sm text-muted">{body}</p>}
    </div>
  );
}
