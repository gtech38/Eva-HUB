import { notFound } from "next/navigation";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { PageHeader } from "@/components/PageHeader";
import { themeFor } from "@/themes";

export const dynamic = "force-dynamic";

const STR = {
  hotels: { en: "Where to stay", te: "బస", hi: "ठहरने की जगह" },
  airport: { en: "Getting there", te: "ఎలా చేరుకోవాలి", hi: "कैसे पहुँचें" },
  map: { en: "Open map", te: "మ్యాప్ తెరవండి", hi: "नक्शा खोलें" },
  book: { en: "Book", te: "బుక్ చేయండి", hi: "बुक करें" },
};

export default async function TravelPage() {
  const site = await requireViewer();
  if (!site) return null;
  const row = page(site, "TRAVEL");
  if (!row) notFound();
  const { locale } = site;
  const travel = parsePage("TRAVEL", row.content);
  const theme = themeFor(site.event.theme);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={ui("travel", locale)} />
      {t(travel.airport, locale) && (
        <section>
          <h2 className="eyebrow mb-3 text-center">{t(STR.airport, locale)}</h2>
          <p className="text-center text-lg">{t(travel.airport, locale)}</p>
          {travel.mapUrl && (
            <p className="mt-3 text-center">
              <a href={travel.mapUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                {t(STR.map, locale)}
              </a>
            </p>
          )}
        </section>
      )}
      {travel.hotels.length > 0 && (
        <>
          <theme.Divider />
          <section>
            <h2 className="eyebrow mb-4 text-center">{t(STR.hotels, locale)}</h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {travel.hotels.map((h) => (
                <li key={h.name} className="card p-5">
                  <p className="font-display text-xl">{h.name}</p>
                  {t(h.note, locale) && <p className="mt-2 text-sm text-muted">{t(h.note, locale)}</p>}
                  {h.url && (
                    <a href={h.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline underline-offset-4">
                      {t(STR.book, locale)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
