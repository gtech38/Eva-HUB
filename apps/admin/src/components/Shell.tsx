import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminPrincipal } from "@/lib/auth";

export type NavItem = { href: string; label: string; exact?: boolean };
export type NavSection = { title: string; items: NavItem[] };

export function Shell({ principal, studios, activeStudioId, sections, children }: {
  principal: AdminPrincipal;
  studios: Array<{ id: string; name: string; slug: string }>;
  activeStudioId?: string;
  sections: NavSection[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <Link href="/" className="block text-[11px] font-semibold uppercase tracking-widest text-neutral-500 no-underline">Event Hub</Link>
          <div className="mt-0.5 text-sm font-semibold">Admin</div>
        </div>

        {studios.length > 0 && (
          <div className="border-b border-neutral-200 px-3 py-2">
            <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Studios</div>
            <ul className="space-y-0.5">
              {studios.map((s) => (
                <li key={s.id}>
                  <Link href={`/studios/${s.id}`} className={`block truncate rounded px-2 py-1 text-[13px] no-underline hover:bg-neutral-100 ${s.id === activeStudioId ? "bg-neutral-100 font-medium" : "text-neutral-700"}`} title={s.slug}>
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {sections.map((sec) => (
            <div key={sec.title} className="mb-3">
              <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">{sec.title}</div>
              <ul className="space-y-0.5">
                {sec.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} className="block rounded px-2 py-1 text-[13px] text-neutral-700 no-underline hover:bg-neutral-100">{it.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {principal.isPlatformAdmin && (
            <div className="mb-3">
              <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Platform</div>
              <ul className="space-y-0.5">
                {[["/platform", "Studios"], ["/platform/jobs", "Jobs"], ["/platform/audit", "Audit log"], ["/platform/users", "Users"]].map(([href, label]) => (
                  <li key={href}><Link href={href} className="block rounded px-2 py-1 text-[13px] text-neutral-700 no-underline hover:bg-neutral-100">{label}</Link></li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        <div className="border-t border-neutral-200 px-4 py-3 text-xs">
          <div className="truncate font-medium">{principal.displayName ?? "Signed in"}</div>
          <div className="mt-0.5 flex items-center justify-between text-neutral-500">
            <span>{principal.isPlatformAdmin ? "Platform admin" : "Studio"}</span>
            <form action="/auth/signout" method="post"><button className="underline hover:text-neutral-900">Sign out</button></form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-5">{children}</main>
    </div>
  );
}

export function Tabs({ base, items, current }: { base: string; items: Array<{ href: string; label: string }>; current?: string }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-neutral-200">
      {items.map((it) => {
        const href = `${base}${it.href}`;
        const active = current === it.href;
        return (
          <Link key={it.href} href={href} className={`-mb-px border-b-2 px-3 py-2 text-[13px] no-underline ${active ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"}`}>
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
