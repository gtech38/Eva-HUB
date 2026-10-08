import Link from "next/link";
import { prisma } from "@hub/db";
import { can, storage } from "@hub/shared";
import { getEvent } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { Card, Badge, Field, StatusBadge, Empty } from "@/components/ui";
import { ActionForm, ActionButton, FieldError } from "@/components/forms";
import { lt, fmtBytes, fmtDateTime } from "@/lib/format";
import { Uploader } from "./Uploader";
import { saveAlbum, deleteAlbum, setPhotoHidden, movePhoto, deletePhoto, grantGalleryUnlock, revokeGalleryUnlock, reindexFaces } from "./actions";

export const dynamic = "force-dynamic";

const VIS_TONE = { GUESTS: "green", HOSTS_ONLY: "blue", HIDDEN: "neutral" } as const;

function AlbumForm({ studioId, eventId, album, subs }: { studioId: string; eventId: string; album?: { id: string; title: unknown; visibility: string; vendorVisible: boolean; subEventId: string | null; sortOrder: number }; subs: Array<{ id: string; name: unknown }> }) {
  return (
    <ActionForm action={saveAlbum} submitLabel={album ? "Save" : "Create album"} submitClassName="btn-secondary btn-sm" resetOnSuccess={!album} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_60px] sm:items-end">
      <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} />
      {album && <input type="hidden" name="albumId" value={album.id} />}
      <Field label="Title"><input name="title" className="input" defaultValue={lt(album?.title)} required /><FieldError name="title" /></Field>
      <Field label="Visibility"><select name="visibility" className="input" defaultValue={album?.visibility ?? "GUESTS"}><option>GUESTS</option><option>HOSTS_ONLY</option><option>HIDDEN</option></select></Field>
      <Field label="Sub-event"><select name="subEventId" className="input" defaultValue={album?.subEventId ?? ""}><option value="">—</option>{subs.map((s) => <option key={s.id} value={s.id}>{lt(s.name)}</option>)}</select></Field>
      <Field label="Order"><input name="sortOrder" type="number" className="input" defaultValue={album?.sortOrder ?? 0} /></Field>
      <label className="flex items-center gap-1.5 text-xs sm:col-span-4"><input type="checkbox" name="vendorVisible" defaultChecked={album?.vendorVisible} /> Visible to vendors</label>
    </ActionForm>
  );
}

export default async function GalleryPage({ params, searchParams }: { params: Promise<{ studioId: string; eventId: string }>; searchParams: Promise<{ album?: string; edit?: string }> }) {
  const { studioId, eventId } = await params;
  const { album: albumParam, edit } = await searchParams;
  const p = await requireAdmin(studioId);
  const event = await getEvent(studioId, eventId);
  const base = `/studios/${studioId}/events/${eventId}/gallery`;
  const canAlbums = can(p, "albums.manage", { studioId, eventId });
  const canUpload = can(p, "photos.upload", { studioId, eventId });
  const canHide = can(p, "photos.hide", { studioId, eventId });
  const canGrant = can(p, "entitlements.grant", { studioId, eventId });

  const [albums, subs, counts, unassigned] = await Promise.all([
    prisma.album.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }], include: { _count: { select: { photos: true } } } }),
    prisma.subEvent.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.photo.groupBy({ by: ["status"], _count: { _all: true }, where: { eventId } }),
    prisma.photo.count({ where: { eventId, albumId: null } }),
  ]);
  const selectedAlbumId = albumParam === "unassigned" ? null : (albumParam && albums.some((a) => a.id === albumParam) ? albumParam : albums[0]?.id ?? null);
  const selectedAlbum = albums.find((a) => a.id === selectedAlbumId) ?? null;
  const photos = await prisma.photo.findMany({ where: { eventId, albumId: selectedAlbumId }, orderBy: [{ sortKey: "asc" }, { createdAt: "desc" }], take: 300, include: { _count: { select: { faces: true } } } });
  const thumbs = Object.fromEntries(await Promise.all(photos.map(async (ph) => { const d = (ph.derivatives ?? {}) as { thumb?: string }; return [ph.id, ph.status === "READY" && d.thumb ? await storage.derivativeUrl(d.thumb) : null] as const; })));

  const [faceCount, clusterCount, indexedCount, readyCount, entitlement] = await Promise.all([
    prisma.face.count({ where: { eventId } }),
    prisma.faceCluster.count({ where: { eventId } }),
    prisma.photo.count({ where: { eventId, facesIndexedAt: { not: null } } }),
    prisma.photo.count({ where: { eventId, status: "READY" } }),
    prisma.entitlement.findFirst({ where: { eventId, scope: "GALLERY_FULLRES", userId: null, revokedAt: null } }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-4">
        <Card title="Albums" padded={false}>
          <ul className="divide-y divide-neutral-100">
            {albums.map((a) => (
              <li key={a.id} className={a.id === selectedAlbumId ? "bg-neutral-100" : ""}>
                <Link href={`${base}?album=${a.id}`} className="flex items-center justify-between px-3 py-2 no-underline hover:bg-neutral-50">
                  <span className="truncate text-[13px] font-medium">{lt(a.title)}</span>
                  <span className="flex items-center gap-1"><Badge tone={VIS_TONE[a.visibility]}>{a.visibility}</Badge>{a.vendorVisible && <Badge tone="amber">vendor</Badge>}<span className="text-xs tabular-nums text-neutral-500">{a._count.photos}</span></span>
                </Link>
              </li>
            ))}
            <li className={albumParam === "unassigned" ? "bg-neutral-100" : ""}><Link href={`${base}?album=unassigned`} className="flex items-center justify-between px-3 py-2 text-xs text-neutral-500 no-underline hover:bg-neutral-50"><span>Unassigned</span><span className="tabular-nums">{unassigned}</span></Link></li>
          </ul>
          {canAlbums && <div className="border-t border-neutral-200 p-3"><div className="mb-1 text-xs font-medium text-neutral-600">New album</div><AlbumForm studioId={studioId} eventId={eventId} subs={subs} /></div>}
        </Card>
        <Card title="Photos">
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            {["UPLOADING", "UPLOADED", "PROCESSING", "READY", "FAILED"].map((s) => <div key={s} className="contents"><dt><StatusBadge status={s} /></dt><dd className="text-right tabular-nums">{c(s)}</dd></div>)}
          </dl>
        </Card>
        <Card title="Access">
          {entitlement ? <p className="mb-2 text-xs"><Badge tone="green">unlocked</Badge> Full-res + downloads for every invited guest since {fmtDateTime(entitlement.grantedAt)}.</p> : <p className="mb-2 text-xs"><Badge>locked</Badge> Guests see watermarked images; downloads disabled.</p>}
          {canGrant && (entitlement
            ? <ActionButton action={revokeGalleryUnlock} fields={{ studioId, eventId }} confirm="Lock the gallery again? Guests go back to watermarked images." className="btn-secondary btn-sm">Revoke unlock</ActionButton>
            : <ActionButton action={grantGalleryUnlock} fields={{ studioId, eventId }} confirm="Grant a comped GALLERY_FULLRES entitlement to everyone with gallery access?" className="btn-primary btn-sm">Unlock gallery (comped)</ActionButton>)}
          <p className="help">Stripe checkout for the host package replaces this in Phase 2.</p>
        </Card>
        <Card title="Face search">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-xs">
            <dt className="text-neutral-500">Enabled</dt><dd>{event.faceSearchEnabled ? "yes" : "no"}</dd>
            <dt className="text-neutral-500">Photos READY</dt><dd className="tabular-nums">{readyCount}</dd>
            <dt className="text-neutral-500">Photos indexed</dt><dd className="tabular-nums">{indexedCount}</dd>
            <dt className="text-neutral-500">Face rows</dt><dd className="tabular-nums">{faceCount}</dd>
            <dt className="text-neutral-500">Clusters</dt><dd className="tabular-nums">{clusterCount}</dd>
            <dt className="text-neutral-500">Purge at</dt><dd>{event.faceIndexPurgeAt ? fmtDateTime(event.faceIndexPurgeAt) : "—"}</dd>
          </dl>
          {canAlbums && <div className="mt-2"><ActionButton action={reindexFaces} fields={{ studioId, eventId }} className="btn-secondary btn-sm" disabled={!event.faceSearchEnabled}>Re-index faces</ActionButton></div>}
        </Card>
      </div>

      <div className="space-y-4">
        {selectedAlbum && canAlbums && (
          <Card title={<span>Album: {lt(selectedAlbum.title)}</span>} actions={<ActionButton action={deleteAlbum} fields={{ studioId, eventId, albumId: selectedAlbum.id }} confirm="Delete this album? Its photos move to Unassigned." className="btn-ghost btn-sm text-red-700">Delete album</ActionButton>}>
            <AlbumForm studioId={studioId} eventId={eventId} album={selectedAlbum} subs={subs} />
          </Card>
        )}
        {canUpload && <Card title="Upload"><Uploader studioId={studioId} eventId={eventId} albumId={selectedAlbumId} albumTitle={selectedAlbum ? lt(selectedAlbum.title) : "Unassigned"} /></Card>}
        <Card title={<span>Photos <span className="ml-1 font-normal text-neutral-400">{photos.length}{photos.length === 300 ? "+" : ""}</span></span>}>
          {photos.length === 0 ? <Empty>No photos in {selectedAlbum ? lt(selectedAlbum.title) : "Unassigned"} yet.</Empty> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {photos.map((ph) => (
                <div key={ph.id} className={`rounded border ${edit === ph.id ? "border-neutral-900" : "border-neutral-200"} bg-white p-1.5`}>
                  <div className="relative aspect-[4/3] overflow-hidden rounded bg-neutral-100">
                    {thumbs[ph.id] ? <img src={thumbs[ph.id]!} alt={ph.filename} className={`h-full w-full object-cover ${ph.hidden ? "opacity-40" : ""}`} /> : <div className="flex h-full items-center justify-center text-[11px] text-neutral-400">{ph.status === "READY" ? "no thumb" : ph.status.toLowerCase()}</div>}
                    <div className="absolute left-1 top-1 flex gap-1"><StatusBadge status={ph.status} />{ph.hidden && <Badge tone="red">hidden</Badge>}</div>
                  </div>
                  <div className="mt-1 truncate text-[11px]" title={ph.filename}>{ph.filename}</div>
                  <div className="text-[11px] text-neutral-500">{fmtBytes(ph.originalBytes)}{ph.width && ph.height ? ` · ${ph.width}×${ph.height}` : ""}{ph._count.faces ? ` · ${ph._count.faces} faces` : ""}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {canHide && <ActionButton action={setPhotoHidden} fields={{ studioId, eventId, photoId: ph.id, hidden: ph.hidden ? "0" : "1" }} className="btn-ghost btn-sm">{ph.hidden ? "Unhide" : "Hide"}</ActionButton>}
                    {canAlbums && (
                      <ActionForm action={movePhoto} hideSubmit className="flex items-center gap-1">
                        <input type="hidden" name="studioId" value={studioId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="photoId" value={ph.id} />
                        <select name="albumId" className="input !w-auto !py-0.5 text-[11px]" defaultValue={ph.albumId ?? ""}><option value="">Unassigned</option>{albums.map((a) => <option key={a.id} value={a.id}>{lt(a.title)}</option>)}</select>
                        <button className="btn-ghost btn-sm">Move</button>
                      </ActionForm>
                    )}
                    {canAlbums && <ActionButton action={deletePhoto} fields={{ studioId, eventId, photoId: ph.id }} confirm="Delete this photo? (DB row now; object cleanup is a worker TODO)" className="btn-ghost btn-sm text-red-700">×</ActionButton>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
