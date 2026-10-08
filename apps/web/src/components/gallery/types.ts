export type GalleryStrings = {
  download: string;
  favorite: string;
  unfavorite: string;
  close: string;
  prev: string;
  next: string;
  watermarked: string;
  loadingMore: string;
  loadFailed: string;
  retry: string;
};

/** Where the next pages of a grid come from. `nextCursor` is the opaque cursor after the rendered page. */
export type MoreSource = {
  /** e.g. `/api/gallery/<albumId>` or `/api/gallery/me?subject=<id>`; the grid appends `cursor=`. */
  endpoint: string;
  nextCursor: string | null;
};
