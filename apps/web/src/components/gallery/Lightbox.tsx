"use client";

import { useEffect } from "react";
import type { PhotoDTO } from "@/lib/gallery";
import { counterLabel } from "@/lib/galleryGrid";
import type { GalleryStrings } from "./types";
import { Heart } from "./PhotoCell";

type Props = {
  photos: PhotoDTO[];
  index: number;
  /** Total photos in the feed when known (more may still be loading); defaults to what is loaded. */
  total?: number;
  /** True while a later page exists, so "next" stays available at the end of the loaded photos. */
  hasMore: boolean;
  strings: GalleryStrings;
  canFavorite: boolean;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onToggle: (id: string) => void;
};

export function Lightbox({ photos, index, total, hasMore, strings, canFavorite, onStep, onClose, onToggle }: Props) {
  const current = photos[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onStep(1);
      if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onStep, onClose]);

  if (!current) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="truncate opacity-80">
          {current.filename}
          {!current.canDownload && <span className="ml-2 opacity-60">· {strings.watermarked}</span>}
        </span>
        <div className="flex items-center gap-2">
          {canFavorite && (
            <button type="button" onClick={() => onToggle(current.id)} aria-pressed={current.favorited} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label={current.favorited ? strings.unfavorite : strings.favorite}>
              <Heart filled={current.favorited} />
            </button>
          )}
          {current.canDownload && (
            <a href={`/api/photos/${current.id}/download`} className="rounded border border-white/30 px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-white/10">
              {strings.download}
            </a>
          )}
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label={strings.close}>
            ×
          </button>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center px-12" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button type="button" onClick={() => onStep(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 p-3 text-3xl opacity-70 hover:opacity-100" aria-label={strings.prev}>
            ‹
          </button>
        )}
        {current.webUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.webUrl} alt={current.filename} className="max-h-[calc(100dvh-8rem)] max-w-full object-contain" />
        ) : (
          <p className="text-sm opacity-70">{current.filename}</p>
        )}
        {(index < photos.length - 1 || hasMore) && (
          <button type="button" onClick={() => onStep(1)} className="absolute right-2 top-1/2 -translate-y-1/2 p-3 text-3xl opacity-70 hover:opacity-100" aria-label={strings.next}>
            ›
          </button>
        )}
      </div>
      <p className="pb-3 text-center text-xs opacity-60">
        {counterLabel({ index, loaded: photos.length, total, hasMore })}
      </p>
    </div>
  );
}
