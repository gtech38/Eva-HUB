// tdd-exempt: presentational client component; the rules it calls are tested in lib/registry*.test.ts
"use client";

import { useState, useTransition } from "react";
import { claimItem, undoClaim } from "@/app/sites/[slug]/registry/actions";

export type ClaimStrings = {
  markPurchased: string;
  youPurchased: string;
  fullyPurchased: string;
  undo: string;
  quantity: string;
};

type Props = {
  itemId: string;
  remaining: number;
  canClaim: boolean;
  purchasedByViewer: boolean;
  /** Claim ids this viewer may still undo (own claims within 24 h). */
  undoableClaimIds: string[];
  strings: ClaimStrings;
};

export function ClaimControls({ itemId, remaining, canClaim, purchasedByViewer, undoableClaimIds, strings }: Props) {
  const [qty, setQty] = useState(1);
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
      {undoableClaimIds.map((id) => (
        <button key={id} type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => run(() => undoClaim(id))}>
          {strings.undo}
        </button>
      ))}
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
              <select className="input w-20" value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={pending}>
                {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn" disabled={pending}>
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
