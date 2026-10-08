import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { t } from "@hub/shared/i18n";
import { requireViewer } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { PhotoGrid } from "@/components/gallery/PhotoGrid";
import { galleryStrings } from "@/lib/gallery-strings";
import { visibleVisibilities, listAlbumPage, countAlbumPhotos } from "@/lib/gallery";
import { encodeCursor } from "@/lib/galleryCursor";

export const dynamic = "force-dynamic";

export default async function AlbumPage({ params }: { params: Promise<{ albumId: string }> }) {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  if (!viewer.can("gallery.view")) notFound();
  const { albumId } = await params;
  const S = galleryStrings(locale);

  const album = await prisma.album.findFirst({ where: { id: albumId, eventId: event.id, visibility: { in: visibleVisibilities(viewer) } } });
  if (!album) notFound();

  // Only the first page is rendered here; PhotoGrid fetches the rest from /api/gallery/<albumId>.
  const [first, total] = await Promise.all([listAlbumPage(event.id, viewer, album.id), countAlbumPhotos(event.id, viewer, album.id)]);
  const more = { endpoint: `/api/gallery/${album.id}`, nextCursor: first.nextCursor && encodeCursor(first.nextCursor) };

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link href="/gallery" className="underline underline-offset-4 hover:opacity-70">
          ← {S.backToGallery}
        </Link>
      </p>
      <PageHeader title={t(album.title as object, locale)} intro={`${total} ${S.photos}`} />
      {first.photos.length === 0 ? (
        <EmptyState title={S.empty} body={S.emptyBody} />
      ) : (
        <PhotoGrid photos={first.photos} strings={S} canFavorite={viewer.can("favorites")} more={more} total={total} />
      )}
    </div>
  );
}
