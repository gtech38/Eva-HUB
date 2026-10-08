"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { PhotoDTO } from "@/lib/gallery";
import { columnsForWidth, gapForWidth, rowHeight, toRows } from "@/lib/galleryGrid";

type Props = { photos: PhotoDTO[]; renderCell: (photo: PhotoDTO, index: number) => ReactNode };
type Measure = { width: number; viewport: number; top: number };

/**
 * Window-scrolled grid that mounts only the rows near the viewport. Used once an album has more
 * than VIRTUALISE_ABOVE photos loaded; smaller grids stay plain. Cells are squares, so a row's
 * height follows from the measured width, which keeps the layout identical to the plain grid.
 */
export function VirtualGrid({ photos, renderCell }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Measure>({ width: 0, viewport: 1024, top: 0 });

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, viewport: window.innerWidth, top: el.getBoundingClientRect().top + window.scrollY };
      setM((cur) => (cur.width === next.width && cur.viewport === next.viewport && cur.top === next.top ? cur : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const columns = columnsForWidth(m.viewport);
  const gap = gapForWidth(m.viewport);
  const rows = toRows(photos, columns);
  const size = rowHeight(m.width, columns, gap);

  const virtualizer = useWindowVirtualizer({ count: rows.length, estimateSize: () => size, overscan: 4, scrollMargin: m.top });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, size, columns]);

  return (
    <div ref={listRef} role="list" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((vr) => (
        <div
          key={vr.key}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${vr.start - virtualizer.options.scrollMargin}px)`,
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap,
          }}
        >
          {rows[vr.index].map((p, c) => renderCell(p, vr.index * columns + c))}
        </div>
      ))}
    </div>
  );
}
