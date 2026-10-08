"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Overview"], ["/settings", "Settings"], ["/members", "Members"], ["/pages", "Pages"], ["/schedule", "Schedule"],
  ["/guests", "Guests"], ["/invites", "Invitations"], ["/gallery", "Gallery"], ["/registry", "Registry"], ["/jobs", "Jobs"],
] as const;

export function EventTabs({ base }: { base: string }) {
  const path = usePathname();
  const rest = path.startsWith(base) ? path.slice(base.length) : "";
  const current = rest === "" ? "" : `/${rest.split("/")[1]}`;
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-neutral-200">
      {TABS.map(([href, label]) => {
        const active = current === href;
        return (
          <Link key={href} href={`${base}${href}`} className={`-mb-px border-b-2 px-3 py-2 text-[13px] no-underline ${active ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"}`}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
