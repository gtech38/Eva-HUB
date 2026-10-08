"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@hub/shared/i18n";

const LABELS: Record<Locale, { days: string; hours: string; minutes: string; today: string; past: string }> = {
  en: { days: "days", hours: "hours", minutes: "minutes", today: "Today", past: "The celebration has begun" },
  te: { days: "రోజులు", hours: "గంటలు", minutes: "నిమిషాలు", today: "ఈరోజు", past: "వేడుక ప్రారంభమైంది" },
  hi: { days: "दिन", hours: "घंटे", minutes: "मिनट", today: "आज", past: "उत्सव शुरू हो गया है" },
};

function parts(target: number, now: number) {
  const diff = target - now;
  if (diff <= 0) return null;
  const days = Math.floor(diff / 864e5);
  const hours = Math.floor((diff % 864e5) / 36e5);
  const minutes = Math.floor((diff % 36e5) / 6e4);
  return { days, hours, minutes };
}

export function Countdown({ startsOn, locale }: { startsOn: string; locale: Locale }) {
  const target = new Date(startsOn).getTime();
  // Render the server-safe day count first; refine on the client every minute.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const L = LABELS[locale];
  const p = parts(target, now ?? Date.now());
  if (!p) return <p className="text-sm uppercase tracking-[0.2em]">{L.past}</p>;
  const cells: Array<[number, string]> = [
    [p.days, L.days],
    [p.hours, L.hours],
    [p.minutes, L.minutes],
  ];
  return (
    <div className="flex items-end justify-center gap-6 sm:gap-10" suppressHydrationWarning>
      {cells.map(([n, label]) => (
        <div key={label} className="text-center">
          <div className="font-display text-3xl tabular-nums sm:text-4xl" suppressHydrationWarning>
            {now === null && label !== L.days ? "–" : n}
          </div>
          <div className="mt-1 text-[0.65rem] uppercase tracking-[0.2em] text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}
