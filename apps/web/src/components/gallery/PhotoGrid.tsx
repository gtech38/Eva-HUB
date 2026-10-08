"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { PhotoDTO } from "@/lib/gallery";
import { toggleFavorite } from "@/app/sites/[slug]/gallery/actions";

export type GalleryStrings = {
  download: string;
  favorite: string;
  unfavorite: string;
  close: string;
  prev: string;
  next: string;
  watermarked: string;
};

type Props = { photos: PhotoDTO[]; strings: GalleryStrings; canFavorite: boolean };

export function PhotoGrid({ photos: initial, strings, canFavorite }: Props) {
  const [photos, setPhotos] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [, start] = useTransition();

  useEffect(() => setPhotos(initial), [initial]);

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

  // Keyboard navigation for the lightbox.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, photos.length]);

  const current = open !== null ? photos[open] : null;

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:gap-3">
        {photos.map((p, i) => (
          <li key={p.id} className="group relative aspect-square overflow-hidden rounded-theme bg-surface">
            <button type="button" onClick={() => setOpen(i)} className="block h-full w-full" aria-label={p.filename}>
              {p.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-muted">{p.filename}</span>
              )}
            </button>
            {canFavorite && (
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={p.favorited}
                aria-label={p.favorited ? strings.unfavorite : strings.favorite}
                className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition ${p.favorited ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
              >
                <Heart filled={p.favorited} />
              </button>
            )}
            {typeof p.score === "number" && (
              <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[0.65rem] text-white">{Math.round(p.score * 100)}%</span>
            )}
          </li>
        ))}
      </ul>

      {current && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <span className="truncate opacity-80">
              {current.filename}
              {!current.canDownload && <span className="ml-2 opacity-60">· {strings.watermarked}</span>}
            </span>
            <div className="flex items-center gap-2">
              {canFavorite && (
                <button type="button" onClick={() => toggle(current.id)} aria-pressed={current.favorited} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label={current.favorited ? strings.unfavorite : strings.favorite}>
                  <Heart filled={current.favorited} />
                </button>
              )}
              {current.canDownload && (
                <a href={`/api/photos/${current.id}/download`} className="rounded border border-white/30 px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-white/10">
                  {strings.download}
                </a>
              )}
              <button type="button" onClick={() => setOpen(null)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label={strings.close}>
                ×
              </button>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center px-12" onClick={(e) => e.stopPropagation()}>
            {open! > 0 && (
              <button type="button" onClick={() => setOpen(open! - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 p-3 text-3xl opacity-70 hover:opacity-100" aria-label={strings.prev}>
                ‹
              </button>
            )}
            {current.webUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.webUrl} alt={current.filename} className="max-h-[calc(100dvh-8rem)] max-w-full object-contain" />
            ) : (
              <p className="text-sm opacity-70">{current.filename}</p>
            )}
            {open! < photos.length - 1 && (
              <button type="button" onClick={() => setOpen(open! + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 p-3 text-3xl opacity-70 hover:opacity-100" aria-label={strings.next}>
                ›
              </button>
            )}
          </div>
          <p className="pb-3 text-center text-xs opacity-60">
            {open! + 1} / {photos.length}
          </p>
        </div>
      )}
    </>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" />
    </svg>
  );
}
