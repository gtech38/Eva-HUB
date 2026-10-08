import { describe, expect, it } from "vitest";
import {
  PREFETCH_WITHIN,
  VIRTUALISE_ABOVE,
  appendUnique,
  clampIndex,
  columnsForWidth,
  counterLabel,
  gapForWidth,
  pageUrl,
  rowHeight,
  shouldPrefetch,
  shouldVirtualise,
  toRows,
} from "./galleryGrid";

describe("shouldVirtualise", () => {
  it("keeps the plain grid up to 300 items and virtualises beyond", () => {
    expect(VIRTUALISE_ABOVE).toBe(300);
    expect(shouldVirtualise(0)).toBe(false);
    expect(shouldVirtualise(300)).toBe(false);
    expect(shouldVirtualise(301)).toBe(true);
  });
});

describe("responsive columns (mirror grid-cols-2 sm:grid-cols-3 md:grid-cols-4)", () => {
  it.each([
    [320, 2],
    [639, 2],
    [640, 3],
    [767, 3],
    [768, 4],
    [1920, 4],
  ])("%ipx wide -> %i columns", (width, cols) => {
    expect(columnsForWidth(width)).toBe(cols);
  });

  it("uses the lg:gap-3 gap from 1024px and gap-2 below", () => {
    expect(gapForWidth(1023)).toBe(8);
    expect(gapForWidth(1024)).toBe(12);
  });
});

describe("toRows", () => {
  it("chunks items into rows of `columns`, the last row possibly short", () => {
    expect(toRows([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(toRows([], 4)).toEqual([]);
  });
});

describe("rowHeight", () => {
  it("is the square cell size plus the gap below it", () => {
    // 4 columns, 12px gaps, 1000px wide: cell = (1000 - 3*12) / 4 = 241
    expect(rowHeight(1000, 4, 12)).toBe(241 + 12);
  });

  it("never returns a non-positive height for a zero-width container", () => {
    expect(rowHeight(0, 2, 8)).toBeGreaterThan(0);
  });
});

describe("shouldPrefetch", () => {
  const base = { loaded: 60, hasMore: true, loading: false };

  it("fires when the viewer is within 5 photos of the last loaded one", () => {
    expect(PREFETCH_WITHIN).toBe(5);
    // 60 loaded, last index 59: five photos remain after index 54
    expect(shouldPrefetch({ ...base, index: 53 })).toBe(false);
    expect(shouldPrefetch({ ...base, index: 54 })).toBe(true);
    expect(shouldPrefetch({ ...base, index: 59 })).toBe(true);
  });

  it("does not fire far from the end, with no more pages, or while a page is loading", () => {
    expect(shouldPrefetch({ ...base, index: 0 })).toBe(false);
    expect(shouldPrefetch({ ...base, index: 59, hasMore: false })).toBe(false);
    expect(shouldPrefetch({ ...base, index: 59, loading: true })).toBe(false);
  });
});

describe("counterLabel", () => {
  it("uses the real total when the feed knows it", () => {
    expect(counterLabel({ index: 57, loaded: 60, total: 2000, hasMore: true })).toBe("58 / 2000");
  });

  it("marks the loaded count as a lower bound when more pages exist and the total is unknown", () => {
    expect(counterLabel({ index: 3, loaded: 24, hasMore: true })).toBe("4 / 24+");
  });

  it("shows the loaded count once nothing more can load", () => {
    expect(counterLabel({ index: 3, loaded: 24, hasMore: false })).toBe("4 / 24");
  });
});

describe("clampIndex", () => {
  it("keeps the open photo inside what is loaded", () => {
    expect(clampIndex(5, 10)).toBe(5);
    expect(clampIndex(12, 10)).toBe(9);
    expect(clampIndex(-1, 10)).toBe(0);
  });

  it("returns null when nothing is loaded, so the lightbox closes", () => {
    expect(clampIndex(0, 0)).toBeNull();
  });
});

describe("pageUrl", () => {
  it("adds the cursor as the first query parameter of a bare endpoint", () => {
    expect(pageUrl("/api/gallery/abc", "Zm9v")).toBe("/api/gallery/abc?cursor=Zm9v");
  });

  it("appends to an endpoint that already has a query, and escapes the cursor", () => {
    expect(pageUrl("/api/gallery/me?subject=c1", "a+b/c=")).toBe("/api/gallery/me?subject=c1&cursor=a%2Bb%2Fc%3D");
  });
});

describe("appendUnique", () => {
  it("appends new items in order and drops ids already present", () => {
    const a = [{ id: "1" }, { id: "2" }];
    const b = [{ id: "2" }, { id: "3" }, { id: "3" }];
    expect(appendUnique(a, b)).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  it("returns the same array when nothing is new", () => {
    const a = [{ id: "1" }];
    expect(appendUnique(a, [{ id: "1" }])).toBe(a);
  });
});
