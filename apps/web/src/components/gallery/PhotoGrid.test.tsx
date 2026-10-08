import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PhotoDTO } from "@/lib/gallery";
import { PhotoGrid } from "./PhotoGrid";
import type { GalleryStrings } from "./types";

// The favorite toggle is a server action (prisma, cookies); markup tests never call it.
vi.mock("@/app/sites/[slug]/gallery/actions", () => ({ toggleFavorite: vi.fn() }));

const strings: GalleryStrings = {
  download: "Download",
  favorite: "Add to favorites",
  unfavorite: "Remove from favorites",
  close: "Close",
  prev: "Previous",
  next: "Next",
  watermarked: "preview",
  loadingMore: "Loading more photos…",
  loadFailed: "Couldn't load more photos.",
  retry: "Try again",
};

const photos = (n: number): PhotoDTO[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    filename: `p${i}.jpg`,
    width: 100,
    height: 100,
    albumId: "a1",
    thumbUrl: `https://cdn.test/p${i}-t.jpg`,
    webUrl: `https://cdn.test/p${i}-w.jpg`,
    favorited: false,
    canDownload: false,
  }));

const imgCount = (html: string) => (html.match(/<img\b/g) ?? []).length;

describe("PhotoGrid server render", () => {
  it("renders one thumbnail per photo of the page it is given: a 60-photo first page is 60 <img> tags", () => {
    const html = renderToStaticMarkup(
      <PhotoGrid photos={photos(60)} strings={strings} canFavorite={false} more={{ endpoint: "/api/gallery/a1", nextCursor: "abc" }} total={2000} />,
    );
    expect(imgCount(html)).toBe(60);
  });

  it("does not render a lightbox or the loading text before anything is requested", () => {
    const html = renderToStaticMarkup(<PhotoGrid photos={photos(3)} strings={strings} canFavorite={false} more={{ endpoint: "/e", nextCursor: "abc" }} />);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain(strings.loadingMore);
  });

  it("renders no sentinel when there is no further page", () => {
    const withMore = renderToStaticMarkup(<PhotoGrid photos={photos(3)} strings={strings} canFavorite={false} more={{ endpoint: "/e", nextCursor: "abc" }} />);
    const last = renderToStaticMarkup(<PhotoGrid photos={photos(3)} strings={strings} canFavorite={false} more={{ endpoint: "/e", nextCursor: null }} />);
    const plain = renderToStaticMarkup(<PhotoGrid photos={photos(3)} strings={strings} canFavorite={false} />);
    expect(withMore).toContain("aria-live");
    expect(last).not.toContain("aria-live");
    expect(plain).not.toContain("aria-live");
  });

  it("virtualises past 300 photos: far fewer <img> than photos in the markup", () => {
    const html = renderToStaticMarkup(<PhotoGrid photos={photos(2000)} strings={strings} canFavorite={false} />);
    expect(imgCount(html)).toBeLessThan(100);
  });
});
