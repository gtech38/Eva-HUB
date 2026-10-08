/**
 * Pure layout and paging rules for the incremental PhotoGrid. No React, no server imports, so the
 * client component can use it and the rules stay unit-testable.
 */

/** Above this many loaded items the grid renders only the rows near the viewport. */
export const VIRTUALISE_ABOVE = 300;
/** Lightbox navigation asks for the next page when this many photos (or fewer) remain. */
export const PREFETCH_WITHIN = 5;

export const shouldVirtualise = (count: number) => count > VIRTUALISE_ABOVE;

/** Same breakpoints as the plain grid's `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`. */
export function columnsForWidth(viewportWidth: number): number {
  if (viewportWidth >= 768) return 4;
  if (viewportWidth >= 640) return 3;
  return 2;
}

/** `gap-2`, and `lg:gap-3` from 1024px. */
export const gapForWidth = (viewportWidth: number): number => (viewportWidth >= 1024 ? 12 : 8);

export function toRows<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

/** Height of one virtual row: a square cell plus the gap that separates it from the next row. */
export function rowHeight(containerWidth: number, columns: number, gap: number): number {
  const cell = (containerWidth - gap * (columns - 1)) / columns;
  return Math.max(1, cell) + gap;
}

export function shouldPrefetch(s: { index: number; loaded: number; hasMore: boolean; loading: boolean }): boolean {
  if (!s.hasMore || s.loading) return false;
  return s.loaded - 1 - s.index <= PREFETCH_WITHIN;
}

/** URL of the page after `cursor` for a feed endpoint that may already carry query parameters. */
export const pageUrl = (endpoint: string, cursor: string): string =>
  `${endpoint}${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;

/** Append `incoming` after `existing`, skipping ids already shown (a page refetch must not duplicate). */
export function appendUnique<T extends { id: string }>(existing: T[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map((x) => x.id));
  const fresh: T[] = [];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}
