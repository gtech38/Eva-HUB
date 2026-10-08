// tdd-exempt: presentational client component; the rules it calls are tested in lib/registry*.test.ts
"use client";

import { useState, useTransition } from "react";
import { claimItem, undoClaim } from "@/app/sites/[slug]/registry/actions";
import { clampQuantity } from "@/lib/registry";

export type ClaimStrings = {
  markPurchased: string;
  youPurchased: string;
  fullyPurchased: string;
  undo: string;
  quantity: string;
};

type Props = {
  itemId: string;
  /** Used to label the buttons so a screen reader can tell items apart. */
  itemTitle: string;
  remaining: number;
  canClaim: boolean;
  purchasedByViewer: boolean;
  /** This viewer's own claims they may still undo (within 24 h). */
  undoableClaims: Array<{ id: string; quantity: number }>;
  strings: ClaimStrings;
};

export function ClaimControls({ itemId, itemTitle, remaining, canClaim, purchasedByViewer, undoableClaims, strings }: Props) {
  const [chosen, setChosen] = useState(1);
  // The page may re-render with fewer units left than the select last showed; never submit more than remains.
  const qty = clampQuantity(chosen, remaining);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => ReturnType<typeof claimItem>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.message || null);
    });

  return (
    <div className="mt-4 space-y-2">
      {purchasedByViewer && (
        <p className="text-sm font-medium" data-testid="you-purchased">
          {strings.youPurchased}
        </p>
      )}
      {undoableClaims.map(({ id, quantity }) => {
        const suffix = quantity > 1 ? ` ×${quantity}` : "";
        return (
          <button
            key={id}
            type="button"
            className="btn-ghost text-xs"
            aria-label={`${strings.undo}: ${itemTitle}${suffix}`}
            disabled={pending}
            onClick={() => run(() => undoClaim(id))}
          >
            {strings.undo}
            {suffix}
          </button>
        );
      })}
      {remaining > 0 && canClaim && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => claimItem(itemId, qty));
          }}
        >
          {remaining > 1 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              {strings.quantity}
              <select className="input w-20" value={qty} onChange={(e) => setChosen(Number(e.target.value))} disabled={pending}>
                {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn" disabled={pending} aria-label={`${strings.markPurchased}: ${itemTitle}`}>
            {strings.markPurchased}
          </button>
        </form>
      )}
      {remaining === 0 && !purchasedByViewer && <p className="text-sm text-muted">{strings.fullyPurchased}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
