import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { t } from "@hub/shared/i18n";
import { requireViewer } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { PhotoGrid } from "@/components/gallery/PhotoGrid";
import { galleryStrings } from "@/lib/gallery-strings";
import { visibleVisibilities, visiblePhotoWhere, isEntitledFullRes, toPhotoDTOs } from "@/lib/gallery";

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

  const photos = await prisma.photo.findMany({ where: visiblePhotoWhere(event.id, viewer, { albumId }), orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }] });
  const entitled = await isEntitledFullRes(event.id, viewer.principal.userId);
  const dtos = await toPhotoDTOs(photos, viewer, { entitled });

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link href="/gallery" className="underline underline-offset-4 hover:opacity-70">
          ← {S.backToGallery}
        </Link>
      </p>
      <PageHeader title={t(album.title as object, locale)} intro={`${photos.length} ${S.photos}`} />
      {dtos.length === 0 ? <EmptyState title={S.empty} body={S.emptyBody} /> : <PhotoGrid photos={dtos} strings={S} canFavorite={viewer.can("favorites")} />}
    </div>
  );
}
