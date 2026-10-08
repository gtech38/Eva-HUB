// tdd-exempt: route shell; grouping and storage-key scoping are tested in lib/party.test.ts
import { notFound } from "next/navigation";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { derivativeUrl } from "@hub/shared/storage";
import { requireViewer, page } from "@/lib/site";
import { hostsPageLabel } from "@/lib/eventCopy";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { groupByRole, isEventSiteKey } from "@/lib/party";

export const dynamic = "force-dynamic";

export default async function PartyPage() {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale } = site;
  const row = page(site, "WEDDING_PARTY");
  if (!row) notFound();

  const { members } = parsePage("WEDDING_PARTY", row.content);
  const title = hostsPageLabel(event.kind, locale);

  // Page content is host-authored: only sign site assets of this event (never orig/, d/ or zip/).
  const withPhotos = await Promise.all(
    members.map(async (m) => ({
      ...m,
      photoUrl: isEventSiteKey(m.photoKey, event.studioId, event.id) ? await derivativeUrl(m.photoKey) : null,
    })),
  );
  const groups = groupByRole(withPhotos, locale);

  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={title} />
        <EmptyState title={ui("nothingYet", locale)} body={ui("checkBackSoon", locale)} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={title} />
      <div className="space-y-12">
        {groups.map((group) => (
          <section key={group.role || "_"} aria-label={group.role || title}>
            {group.role && <h2 className="eyebrow mb-5 text-center">{group.role}</h2>}
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {group.members.map((m, i) => (
                <li key={`${m.name}-${i}`} className="card flex flex-col items-center p-5 text-center" data-testid="party-member">
                  {m.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photoUrl} alt={m.name} loading="lazy" className="mb-4 aspect-square w-40 rounded-full object-cover" />
                  ) : (
                    <div
                      aria-hidden
                      className="mb-4 flex aspect-square w-40 items-center justify-center rounded-full bg-surface font-display text-5xl text-muted"
                    >
                      {m.name.trim().charAt(0).toUpperCase()}
                    </div>
                  )}
                  <h3 className="font-display text-2xl">{m.name}</h3>
                  {t(m.blurb, locale) && <p className="mt-2 text-sm text-muted">{t(m.blurb, locale)}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
