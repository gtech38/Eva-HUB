/**
 * Pure registry rules: availability, over-claim check, the 24 h undo window and safe external links.
 * No Prisma, no Next: the DB-backed operations live in registryClaims.ts and call into these.
 */

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A repeat claim by the same user on the same item within this window is a double submit, not a new claim. */
export const CLAIM_DEDUPE_WINDOW_MS = 10_000;

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
  /** The viewer's own claims they may still undo (with quantity, so several Undo buttons are distinguishable). */
  undoableClaims: Array<{ id: string; quantity: number }>;
};

export function registryItemView(item: ItemLike, claims: ReadonlyArray<ClaimLike>, userId: string, now: Date): RegistryItemView {
  const mine = claims.filter((c) => c.userId === userId);
  return {
    remaining: remainingQuantity(item, claims),
    claimed: claimedQuantity(claims),
    purchasedByViewer: mine.length > 0,
    undoableClaims: mine.filter((c) => canUndoClaim(c, userId, now)).map((c) => ({ id: c.id, quantity: c.quantity })),
  };
}

/**
 * Claims may only be written while the Registry page is enabled and the event is LIVE. Server
 * actions bypass the layout (which hides disabled pages and shows "not live yet"), so they check this.
 */
export function claimGate(input: { registryEnabled: boolean; eventStatus: string }): "unavailable" | null {
  return input.registryEnabled && input.eventStatus === "LIVE" ? null : "unavailable";
}

/**
 * Taking back your own claim only needs a LIVE event: if the host later disables the Registry
 * page, a guest must still be able to undo within the 24 h window (the claim is theirs, and
 * ownership/window are enforced by `undoRegistryClaim`).
 */
export function undoGate(input: { eventStatus: string }): "unavailable" | null {
  return input.eventStatus === "LIVE" ? null : "unavailable";
}

/** The quantity to submit: at least 1, at most what remains (0 when nothing remains). */
export function clampQuantity(requested: number, remaining: number): number {
  if (remaining <= 0) return 0;
  const whole = Number.isFinite(requested) ? Math.floor(requested) : 1;
  return Math.min(Math.max(whole, 1), remaining);
}

export type ClaimRefusal = "invalid_quantity" | "sold_out" | "exceeds_remaining" | "not_found" | "forbidden" | "unavailable" | "failed";

/** UI string (packages/shared i18n UI key) shown for each way a claim can be refused. */
export function claimMessageKey(reason: ClaimRefusal): "claimSoldOut" | "claimTooMany" | "claimFailed" {
  switch (reason) {
    case "sold_out": return "claimSoldOut";
    case "exceeds_remaining":
    case "invalid_quantity": return "claimTooMany";
    case "not_found":
    case "forbidden":
    case "unavailable":
    case "failed": return "claimFailed";
  }
}

/**
 * Host-authored links are rendered as hrefs, so only absolute http(s) URLs are allowed (no
 * javascript:/data:/vbscript:/file:, no protocol-relative or relative links, no embedded
 * credentials). The WHATWG parser already strips tabs/newlines and leading control characters, so
 * obfuscated schemes resolve to their real protocol and are refused. `httpsOnly` is for resources
 * the browser loads on its own (images), where plain http would be mixed content.
 */
export function safeExternalUrl(raw: string | null | undefined, opts: { httpsOnly?: boolean } = {}): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const okProtocol = u.protocol === "https:" || (u.protocol === "http:" && !opts.httpsOnly);
    if (!okProtocol || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
