"use client";

import type { PhotoDTO } from "@/lib/gallery";
import type { GalleryStrings } from "./types";

type Props = {
  photo: PhotoDTO;
  index: number;
  strings: GalleryStrings;
  canFavorite: boolean;
  /** Native lazy loading only matters in the plain grid; virtual rows mount on demand. */
  lazy: boolean;
  onOpen: (index: number) => void;
  onToggle: (id: string) => void;
};

export function PhotoCell({ photo: p, index, strings, canFavorite, lazy, onOpen, onToggle }: Props) {
  return (
    <div role="listitem" className="group relative aspect-square overflow-hidden rounded-theme bg-surface">
      <button type="button" onClick={() => onOpen(index)} className="block h-full w-full" aria-label={p.filename}>
        {p.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumbUrl} alt="" loading={lazy ? "lazy" : undefined} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-muted">{p.filename}</span>
        )}
      </button>
      {canFavorite && (
        <button
          type="button"
          onClick={() => onToggle(p.id)}
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
    </div>
  );
}

export function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" />
    </svg>
  );
}
