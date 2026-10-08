// tdd-exempt: presentational client component (clipboard side effect only)
"use client";

import { useState } from "react";

export function CopyButton({ text, label, doneLabel }: { text: string; label: string; doneLabel: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard blocked (insecure context): the handle is visible next to the button to copy by hand.
        }
      }}
    >
      {done ? doneLabel : label}
    </button>
  );
}
