import Link from "next/link";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { storage } from "@hub/shared";
import { requireViewer, page } from "@/lib/site";
import { themeFor } from "@/themes";
import { eventCopy } from "@/lib/eventCopy";
import { fmtDateTime } from "@/lib/format";
import { prisma } from "@hub/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  const theme = themeFor(event.theme);
  const home = parsePage("HOME", page(site, "HOME")?.content);
  const heroUrl = home.heroKey ? await storage.derivativeUrl(home.heroKey) : null;

  // A small preview of what's next, so the home page isn't just a hero.
  const upcoming = await prisma.subEvent.findMany({
    where: {
      eventId: event.id,
      ...(viewer.seesAllSubEvents || !viewer.guest ? {} : { invites: { some: { guest: { householdId: viewer.guest.householdId, deletedAt: null } } } }),
    },
    orderBy: { startsAt: "asc" },
    take: 3,
  });

  return (
    <div className="space-y-12">
      <theme.Hero
        title={t(event.title as object, locale)}
        monogram={site.monogram}
        headline={t(home.headline, locale)}
        dateLine={t(home.dateLine, locale)}
        startsOn={event.startsOn}
        timezone={event.timezone}
        locale={locale}
        heroUrl={heroUrl}
        copy={eventCopy(event.kind, locale)}
      />

      {upcoming.length > 0 && (
        <section>
          <div className="mb-5 flex items-end justify-between">
            <h2 className="font-display text-2xl">{ui("schedule", locale)}</h2>
            <Link href="/schedule" className="text-sm underline underline-offset-4 hover:opacity-70">
              {ui("schedule", locale)} →
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3">
            {upcoming.map((s) => (
              <li key={s.id} className="card p-5">
                <p className="font-display text-xl">{t(s.name as object, locale)}</p>
                <p className="mt-1 text-sm text-muted">{fmtDateTime(s.startsAt, event.timezone, locale)}</p>
                {s.venueName && <p className="mt-2 text-sm">{s.venueName}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/rsvp" className="card flex items-center justify-between p-6 transition hover:border-accent">
          <span className="font-display text-2xl">{ui("rsvp", locale)}</span>
          <span aria-hidden>→</span>
        </Link>
        <Link href="/gallery" className="card flex items-center justify-between p-6 transition hover:border-accent">
          <span className="font-display text-2xl">{ui("gallery", locale)}</span>
          <span aria-hidden>→</span>
        </Link>
      </section>
    </div>
  );
}
