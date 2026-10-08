import { describe, expect, it } from "vitest";
import { UNDO_WINDOW_MS, canUndoClaim, checkClaim, claimGate, claimMessageKey, clampQuantity, registryItemView, remainingQuantity, safeExternalUrl } from "./registry.ts";

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
    expect(v.undoableClaims).toEqual([{ id: "mine", quantity: 1 }]);
  });

  it("carries each undoable claim's quantity so several Undo buttons can be told apart", () => {
    const v = registryItemView({ quantity: 5 }, [claim({ id: "a", quantity: 1 }), claim({ id: "b", quantity: 3 })], "u1", NOW);
    expect(v.undoableClaims).toEqual([
      { id: "a", quantity: 1 },
      { id: "b", quantity: 3 },
    ]);
  });

  it("does not mark an item as purchased by the viewer when only others claimed it", () => {
    const v = registryItemView(item, [claim({ userId: "u2" })], "u1", NOW);
    expect(v.purchasedByViewer).toBe(false);
    expect(v.undoableClaims).toEqual([]);
    expect(v.remaining).toBe(1);
  });

  it("keeps a purchased-by-viewer flag after the undo window but offers no undo", () => {
    const v = registryItemView(item, [claim({ id: "old", claimedAt: ago(UNDO_WINDOW_MS + 5) })], "u1", NOW);
    expect(v.purchasedByViewer).toBe(true);
    expect(v.undoableClaims).toEqual([]);
  });
});

describe("claimMessageKey", () => {
  it("maps each refusal to a UI string key the guest can read", () => {
    expect(claimMessageKey("sold_out")).toBe("claimSoldOut");
    expect(claimMessageKey("exceeds_remaining")).toBe("claimTooMany");
    expect(claimMessageKey("invalid_quantity")).toBe("claimTooMany");
    expect(claimMessageKey("not_found")).toBe("claimFailed");
    expect(claimMessageKey("forbidden")).toBe("claimFailed");
    expect(claimMessageKey("unavailable")).toBe("claimFailed");
    expect(claimMessageKey("failed")).toBe("claimFailed");
  });
});

describe("claimGate", () => {
  it("allows claims only on a LIVE event whose Registry page is enabled", () => {
    expect(claimGate({ registryEnabled: true, eventStatus: "LIVE" })).toBeNull();
  });

  it("refuses when the host disabled (or never created) the Registry page, even for a guest who knows the action", () => {
    expect(claimGate({ registryEnabled: false, eventStatus: "LIVE" })).toBe("unavailable");
  });

  it("refuses on events that are not live (draft, archived)", () => {
    for (const eventStatus of ["DRAFT", "ARCHIVED", "CLOSED", ""]) {
      expect(claimGate({ registryEnabled: true, eventStatus }), eventStatus).toBe("unavailable");
    }
  });
});

describe("clampQuantity", () => {
  it("never asks for more than what remains, and never less than one", () => {
    expect(clampQuantity(3, 2)).toBe(2);
    expect(clampQuantity(2, 5)).toBe(2);
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(Number.NaN, 5)).toBe(1);
    expect(clampQuantity(2.7, 5)).toBe(2);
  });

  it("returns 0 when nothing remains", () => {
    expect(clampQuantity(1, 0)).toBe(0);
  });
});

describe("safeExternalUrl", () => {
  it("passes http(s) URLs through", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("accepts mixed-case schemes and surrounding whitespace, normalised to a clean URL", () => {
    expect(safeExternalUrl("  HTTPS://Example.com/x  ")).toBe("https://example.com/x");
  });

  it("rejects javascript:, data:, empty and malformed URLs so a host-authored link cannot run script", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "", "not a url", "ftp://x.test/f"]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
  });

  it("rejects obfuscated schemes: case, leading whitespace/control chars, NUL, vbscript:, file:, blob:", () => {
    for (const bad of [
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "\tjavascript:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
    ]) {
      expect(safeExternalUrl(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects protocol-relative and scheme-less links and NUL in the host", () => {
    for (const bad of ["//evil.com/x", "/relative/path", "www.example.com", "https://exa\u0000mple.com", "https://"]) {
      expect(safeExternalUrl(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects links that embed credentials", () => {
    expect(safeExternalUrl("https://user:pw@example.com/")).toBeNull();
  });

  it("with httpsOnly, plain http is refused (used for auto-loaded images)", () => {
    expect(safeExternalUrl("http://example.com/a.jpg", { httpsOnly: true })).toBeNull();
    expect(safeExternalUrl("https://example.com/a.jpg", { httpsOnly: true })).toBe("https://example.com/a.jpg");
  });
});
