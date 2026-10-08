/**
 * Pure registry rules: availability, over-claim check, the 24 h undo window and safe external links.
 * No Prisma, no Next: the DB-backed operations live in registryClaims.ts and call into these.
 */

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ClaimLike = { id: string; quantity: number; userId: string | null; claimedAt: Date };
export type ItemLike = { quantity: number };

export function claimedQuantity(claims: ReadonlyArray<Pick<ClaimLike, "quantity">>): number {
  return claims.reduce((sum, c) => sum + c.quantity, 0);
}

/** How many of this item can still be marked purchased. Never negative. */
export function remainingQuantity(item: ItemLike, claims: ReadonlyArray<Pick<ClaimLike, "quantity">>): number {
  return Math.max(0, item.quantity - claimedQuantity(claims));
}

export type ClaimCheck =
  | { ok: true; quantity: number }
  | { ok: false; reason: "invalid_quantity" | "sold_out" }
  | { ok: false; reason: "exceeds_remaining"; remaining: number };

/** Decide whether `requested` more units may be claimed given the claims already recorded. */
export function checkClaim(item: ItemLike, claims: ReadonlyArray<Pick<ClaimLike, "quantity">>, requested: number): ClaimCheck {
  if (!Number.isInteger(requested) || requested < 1) return { ok: false, reason: "invalid_quantity" };
  const remaining = remainingQuantity(item, claims);
  if (remaining === 0) return { ok: false, reason: "sold_out" };
  if (requested > remaining) return { ok: false, reason: "exceeds_remaining", remaining };
  return { ok: true, quantity: requested };
}

/** Only the claim's own user may undo, and only within 24 h. Anonymous claims are permanent. */
export function canUndoClaim(claim: Pick<ClaimLike, "userId" | "claimedAt">, userId: string, now: Date): boolean {
  if (!claim.userId || claim.userId !== userId) return false;
  return now.getTime() - claim.claimedAt.getTime() <= UNDO_WINDOW_MS;
}

export type RegistryItemView = {
  remaining: number;
  claimed: number;
  purchasedByViewer: boolean;
  /** Claim ids the viewer may still undo. */
  undoableClaimIds: string[];
};

export function registryItemView(item: ItemLike, claims: ReadonlyArray<ClaimLike>, userId: string, now: Date): RegistryItemView {
  const mine = claims.filter((c) => c.userId === userId);
  return {
    remaining: remainingQuantity(item, claims),
    claimed: claimedQuantity(claims),
    purchasedByViewer: mine.length > 0,
    undoableClaimIds: mine.filter((c) => canUndoClaim(c, userId, now)).map((c) => c.id),
  };
}

/** Host-authored links are rendered as hrefs, so only http(s) is allowed (no javascript:/data:). */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
