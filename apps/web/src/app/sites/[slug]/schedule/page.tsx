import { prisma } from "@hub/db";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { fmtDayLabel, fmtTime } from "@/lib/format";
import { themeFor } from "@/themes";

export const dynamic = "force-dynamic";

const STR = {
  invited: { en: "You're invited", te: "మీకు ఆహ్వానం ఉంది", hi: "आप आमंत्रित हैं" },
  dressCode: { en: "Dress code", te: "డ్రెస్ కోడ్", hi: "ड्रेस कोड" },
  map: { en: "Map", te: "మ్యాప్", hi: "नक्शा" },
  rsvpBy: { en: "RSVP by", te: "RSVP గడువు", hi: "RSVP की अंतिम तिथि" },
  none: { en: "Schedule coming soon", te: "షెడ్యూల్ త్వరలో", hi: "कार्यक्रम जल्द ही" },
};

export default async function SchedulePage() {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  const theme = themeFor(event.theme);
  const intro = t(parsePage("SCHEDULE", page(site, "SCHEDULE")?.content).intro, locale);

  // Which sub-events is the viewer's household invited to?
  const invitedIds = new Set<string>();
  if (viewer.guest) {
    const inv = await prisma.subEventInvite.findMany({
      where: { guest: { householdId: viewer.guest.householdId, eventId: event.id, deletedAt: null } },
      select: { subEventId: true },
    });
    for (const i of inv) invitedIds.add(i.subEventId);
  }

  // Guests see only what they're invited to; hosts/staff/planners/vendors see everything.
  const subEvents = await prisma.subEvent.findMany({
    where: { eventId: event.id, ...(viewer.seesAllSubEvents ? {} : { id: { in: [...invitedIds] } }) },
    orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }],
  });

  // Group by day in the event's timezone.
  const days = new Map<string, typeof subEvents>();
  for (const s of subEvents) {
    const key = fmtDayLabel(s.startsAt, event.timezone, locale);
    (days.get(key) ?? days.set(key, []).get(key)!).push(s);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={ui("schedule", locale)} intro={intro} />
      {subEvents.length === 0 ? (
        <EmptyState title={t(STR.none, locale)} />
      ) : (
        [...days.entries()].map(([day, items], di) => (
          <section key={day}>
            {di > 0 && <theme.Divider />}
            <h2 className="eyebrow mb-4 text-center">{day}</h2>
            <ol className="space-y-4">
              {items.map((s) => {
                const invited = invitedIds.has(s.id);
                return (
                  <li key={s.id} className={`card p-5 sm:p-6 ${invited ? "border-accent" : ""}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-display text-2xl">{t(s.name as object, locale)}</h3>
                      <p className="text-sm text-muted">
                        {fmtTime(s.startsAt, event.timezone, locale)}
                        {s.endsAt && ` – ${fmtTime(s.endsAt, event.timezone, locale)}`}
                      </p>
                    </div>
                    {invited && <p className="mt-1 text-xs uppercase tracking-[0.2em] text-accent">{t(STR.invited, locale)}</p>}
                    {s.description && <p className="mt-3 text-base">{t(s.description as object, locale)}</p>}
                    <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      {(s.venueName || s.venueAddress) && (
                        <div>
                          <dd className="font-medium">{s.venueName}</dd>
                          {s.venueAddress && <dd className="text-muted">{s.venueAddress}</dd>}
                          {s.mapUrl && (
                            <dd>
                              <a href={s.mapUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                                {t(STR.map, locale)}
                              </a>
                            </dd>
                          )}
                        </div>
                      )}
                      {s.dressCode && (
                        <div>
                          <dt className="text-muted">{t(STR.dressCode, locale)}</dt>
                          <dd>{t(s.dressCode as object, locale)}</dd>
                        </div>
                      )}
                      {s.rsvpDeadline && invited && (
                        <div>
                          <dt className="text-muted">{t(STR.rsvpBy, locale)}</dt>
                          <dd>{fmtDayLabel(s.rsvpDeadline, event.timezone, locale)}</dd>
                        </div>
                      )}
                    </dl>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
