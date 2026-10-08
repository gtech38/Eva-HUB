"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { PhotoDTO } from "@/lib/gallery";
import { appendUnique, clampIndex, pageUrl, shouldPrefetch, shouldVirtualise } from "@/lib/galleryGrid";
import { toggleFavorite } from "@/app/sites/[slug]/gallery/actions";
import { Lightbox } from "./Lightbox";
import { PhotoCell } from "./PhotoCell";
import { VirtualGrid } from "./VirtualGrid";
import type { GalleryStrings, MoreSource } from "./types";

export type { GalleryStrings, MoreSource } from "./types";

type Props = {
  photos: PhotoDTO[];
  strings: GalleryStrings;
  canFavorite: boolean;
  /** Present when the server rendered only the first page of a longer feed. */
  more?: MoreSource;
  /** Size of the whole feed when known, for the lightbox counter. */
  total?: number;
};

type PageBody = { ok: true; photos: PhotoDTO[]; nextCursor: string | null } | { ok: false; reason: string };

/**
 * Photo grid that loads further pages as the viewer scrolls (IntersectionObserver sentinel) or
 * pages through the lightbox, and virtualises its rows once many photos are loaded.
 */
export function PhotoGrid({ photos: initial, strings, canFavorite, more, total }: Props) {
  const [photos, setPhotos] = useState(initial);
  const [cursor, setCursor] = useState<string | null>(more?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [, start] = useTransition();
  const inflight = useRef(false);
  const advanceWhenLoaded = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // A fresh server render (e.g. router.refresh()) replaces whatever was appended so far.
  useEffect(() => {
    setPhotos(initial);
    setCursor(more?.nextCursor ?? null);
    setFailed(false);
  }, [initial, more?.nextCursor]);

  const loadMore = useCallback(async () => {
    if (!more || cursor === null || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(pageUrl(more.endpoint, cursor), { credentials: "same-origin" });
      const body = (await res.json()) as PageBody;
      if (!res.ok || !body.ok) throw new Error(body.ok ? `HTTP ${res.status}` : body.reason);
      setPhotos((ps) => appendUnique(ps, body.photos));
      setCursor(body.nextCursor);
    } catch {
      setFailed(true);
      advanceWhenLoaded.current = false;
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [more, cursor]);

  // Scrolling: fetch the next page when the sentinel below the grid comes within 800px of the viewport.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || cursor === null || failed || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, failed, loadMore, photos.length]);

  // Lightbox: prefetch when within a few photos of the end of what is loaded.
  useEffect(() => {
    if (open === null || failed) return;
    if (shouldPrefetch({ index: open, loaded: photos.length, hasMore: cursor !== null, loading })) void loadMore();
  }, [open, photos.length, cursor, loading, failed, loadMore]);

  // "Next" pressed on the last loaded photo: move on as soon as its page arrives.
  useEffect(() => {
    if (advanceWhenLoaded.current && open !== null && open + 1 < photos.length) {
      advanceWhenLoaded.current = false;
      setOpen(open + 1);
    }
  }, [photos.length, open]);

  const toggle = useCallback(
    (id: string) => {
      setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, favorited: !p.favorited } : p)));
      start(async () => {
        const r = await toggleFavorite(id);
        if (!r.ok) setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, favorited: !p.favorited } : p)));
      });
    },
    [start],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (open === null) return;
      const target = open + delta;
      if (target < 0) return;
      if (target >= photos.length) {
        if (cursor !== null) {
          advanceWhenLoaded.current = true;
          void loadMore();
        }
        return;
      }
      setOpen(target);
    },
    [open, photos.length, cursor, loadMore],
  );
  const close = useCallback(() => {
    advanceWhenLoaded.current = false; // a pending "next" must not reopen-advance a later lightbox
    setOpen(null);
  }, []);

  // A reset to the first page can leave the open index past the end of the list.
  useEffect(() => {
    if (open === null) return;
    const clamped = clampIndex(open, photos.length);
    if (clamped !== open) setOpen(clamped);
  }, [open, photos.length]);

  const cell = (p: PhotoDTO, i: number, lazy: boolean) => (
    <PhotoCell key={p.id} photo={p} index={i} strings={strings} canFavorite={canFavorite} lazy={lazy} onOpen={setOpen} onToggle={toggle} />
  );

  return (
    <>
      {shouldVirtualise(photos.length) ? (
        <VirtualGrid photos={photos} renderCell={(p, i) => cell(p, i, false)} />
      ) : (
        <div role="list" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:gap-3">
          {photos.map((p, i) => cell(p, i, true))}
        </div>
      )}

      {cursor !== null && (
        <div ref={sentinel} className="py-6 text-center text-sm text-muted" aria-live="polite">
          {failed ? (
            <>
              <span>{strings.loadFailed}</span>{" "}
              <button type="button" className="underline underline-offset-4" onClick={() => void loadMore()}>
                {strings.retry}
              </button>
            </>
          ) : (
            loading && strings.loadingMore
          )}
        </div>
      )}

      {open !== null && photos[open] && (
        <Lightbox photos={photos} index={open} total={total} hasMore={cursor !== null} strings={strings} canFavorite={canFavorite} onStep={step} onClose={close} onToggle={toggle} />
      )}
    </>
  );
}
