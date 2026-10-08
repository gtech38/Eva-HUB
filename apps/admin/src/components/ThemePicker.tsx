"use client";

import { useState } from "react";

export function ThemePicker({ themes, name, defaultValue }: { themes: Array<{ key: string; label: string; swatch: string[] }>; name: string; defaultValue: string }) {
  const [v, setV] = useState(defaultValue);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {themes.map((t) => (
        <label key={t.key} className={`flex cursor-pointer items-center gap-2 rounded border p-2 ${v === t.key ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"}`}>
          <input type="radio" name={name} value={t.key} checked={v === t.key} onChange={() => setV(t.key)} className="sr-only" />
          <span className="flex overflow-hidden rounded border border-neutral-200">
            {t.swatch.map((c) => <span key={c} className="h-6 w-4" style={{ background: c }} />)}
          </span>
          <span className="text-xs"><span className="block font-medium">{t.label}</span><span className="font-mono text-[10px] text-neutral-500">{t.key}</span></span>
        </label>
      ))}
    </div>
  );
}
