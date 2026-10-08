import { describe, expect, it } from "vitest";
import { UNDO_WINDOW_MS, canUndoClaim, checkClaim, registryItemView, remainingQuantity, safeExternalUrl } from "./registry.ts";

const NOW = new Date("2026-06-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const claim = (over: Partial<{ id: string; quantity: number; userId: string | null; claimedAt: Date }> = {}) => ({
  id: "c1",
  quantity: 1,
  userId: "u1",
  claimedAt: ago(1000),
  ...over,
});

describe("remainingQuantity", () => {
  it("claiming an item decrements the shown availability", () => {
    const item = { quantity: 3 };
    expect(remainingQuantity(item, [])).toBe(3);
    expect(remainingQuantity(item, [claim({ quantity: 1 })])).toBe(2);
    expect(remainingQuantity(item, [claim({ quantity: 1 }), claim({ id: "c2", quantity: 2 })])).toBe(0);
  });

  it("never goes negative when claims already exceed the quantity (host lowered it later)", () => {
    expect(remainingQuantity({ quantity: 1 }, [claim({ quantity: 3 })])).toBe(0);
  });
});

describe("checkClaim", () => {
  it("accepts a quantity within what remains", () => {
    expect(checkClaim({ quantity: 3 }, [claim()], 2)).toEqual({ ok: true, quantity: 2 });
  });

  it("a second claim beyond quantity is refused", () => {
    expect(checkClaim({ quantity: 1 }, [claim()], 1)).toEqual({ ok: false, reason: "sold_out" });
    expect(checkClaim({ quantity: 3 }, [claim()], 3)).toEqual({ ok: false, reason: "exceeds_remaining", remaining: 2 });
  });

  it("refuses zero, negative, fractional and non-numeric quantities", () => {
    for (const q of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkClaim({ quantity: 5 }, [], q)).toEqual({ ok: false, reason: "invalid_quantity" });
    }
  });
});

describe("canUndoClaim", () => {
  it("lets the owner undo within 24 hours", () => {
    expect(canUndoClaim(claim({ claimedAt: ago(UNDO_WINDOW_MS - 1) }), "u1", NOW)).toBe(true);
  });

  it("refuses once the 24 hour window has passed", () => {
    expect(canUndoClaim(claim({ claimedAt: ago(UNDO_WINDOW_MS + 1) }), "u1", NOW)).toBe(false);
  });

  it("another guest cannot undo a claim", () => {
    expect(canUndoClaim(claim({ userId: "u1" }), "u2", NOW)).toBe(false);
  });

  it("an anonymous (null userId) claim can never be undone by anyone", () => {
    expect(canUndoClaim(claim({ userId: null }), "u1", NOW)).toBe(false);
  });
});

describe("registryItemView", () => {
  const item = { id: "i1", quantity: 2 };

  it("reports remaining, the viewer's own claims and whether each can be undone", () => {
    const v = registryItemView(
      item,
      [claim({ id: "mine", userId: "u1", claimedAt: ago(1000) }), claim({ id: "theirs", userId: "u2" })],
      "u1",
      NOW,
    );
    expect(v.remaining).toBe(0);
    expect(v.claimed).toBe(2);
    expect(v.purchasedByViewer).toBe(true);
    expect(v.undoableClaimIds).toEqual(["mine"]);
  });

  it("does not mark an item as purchased by the viewer when only others claimed it", () => {
    const v = registryItemView(item, [claim({ userId: "u2" })], "u1", NOW);
    expect(v.purchasedByViewer).toBe(false);
    expect(v.undoableClaimIds).toEqual([]);
    expect(v.remaining).toBe(1);
  });

  it("keeps a purchased-by-viewer flag after the undo window but offers no undo", () => {
    const v = registryItemView(item, [claim({ id: "old", claimedAt: ago(UNDO_WINDOW_MS + 5) })], "u1", NOW);
    expect(v.purchasedByViewer).toBe(true);
    expect(v.undoableClaimIds).toEqual([]);
  });
});

describe("safeExternalUrl", () => {
  it("passes http(s) URLs through", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects javascript:, data:, empty and malformed URLs so a host-authored link cannot run script", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "", "not a url", "ftp://x.test/f"]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
  });
});
