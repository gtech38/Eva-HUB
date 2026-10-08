import Link from "next/link";
import { prisma } from "@hub/db";
import { parsePage } from "@hub/shared/pages";
import { t } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { PhotoGrid } from "@/components/gallery/PhotoGrid";
import { galleryStrings } from "@/lib/gallery-strings";
import { listVisibleAlbums, listFavoritesPage, visiblePhotoWhere } from "@/lib/gallery";
import { encodeCursor } from "@/lib/galleryCursor";
import { faceSearchAllowed } from "@/lib/faceConsent";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  const S = galleryStrings(locale);
  const intro = t(parsePage("GALLERY", page(site, "GALLERY")?.content).intro, locale);

  if (!viewer.can("gallery.view")) {
    return (
      <div>
        <PageHeader title={S.gallery} />
        <EmptyState title={S.empty} />
      </div>
    );
  }

  const albums = await listVisibleAlbums(event.id, viewer, locale);
  const total = await prisma.photo.count({ where: visiblePhotoWhere(event.id, viewer) });

  // Favorites strip: the viewer's hearts across the whole event, 24 to start; PhotoGrid pages the rest.
  const favs = viewer.can("favorites") ? await listFavoritesPage(event.id, viewer, { limit: 24 }) : { photos: [], nextCursor: null };
  const favMore = { endpoint: "/api/gallery/favorites", nextCursor: favs.nextCursor && encodeCursor(favs.nextCursor) };

  return (
    <div>
      <PageHeader title={S.gallery} intro={intro}>
        {event.faceSearchEnabled && faceSearchAllowed(process.env.NODE_ENV) && viewer.can("face.search") && (
          <p className="mt-5">
            <Link href="/gallery/me" className="btn">
              {S.findMe}
            </Link>
          </p>
        )}
      </PageHeader>

      {total === 0 ? (
        <EmptyState title={S.empty} body={S.emptyBody} />
      ) : (
        <>
          <section>
            <h2 className="eyebrow mb-4">{S.albums}</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {albums
                .filter((a) => a.count > 0)
                .map((a) => (
                  <li key={a.id}>
                    <Link href={`/gallery/${a.id}`} className="group block">
                      <div className="aspect-[4/3] overflow-hidden rounded-theme bg-surface">
                        {a.coverUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.coverUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                        )}
                      </div>
                      <p className="mt-2 font-display text-lg leading-tight">{a.title}</p>
                      <p className="text-xs text-muted">
                        {a.count} {S.photos}
                        {a.visibility === "HOSTS_ONLY" && ` · ${S.hostsOnly}`}
                        {a.visibility === "HIDDEN" && ` · ${S.hidden}`}
                      </p>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
          {favs.photos.length > 0 && (
            <section className="mt-12">
              <h2 className="eyebrow mb-4">{S.favorites}</h2>
              <PhotoGrid photos={favs.photos} strings={S} canFavorite={viewer.can("favorites")} more={favMore} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
