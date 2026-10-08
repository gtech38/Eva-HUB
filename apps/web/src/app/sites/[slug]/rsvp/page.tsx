import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { fmtDateTime, fullName } from "@/lib/format";
import { themeFor } from "@/themes";
import { loadHousehold } from "./data";
import { submitRsvp } from "./actions";

export const dynamic = "force-dynamic";

const STR = {
  noGuestRow: { en: "Your account isn't on the guest list for this event, so there is nothing to RSVP for.", te: "మీ ఖాతా ఈ ఈవెంట్ అతిథుల జాబితాలో లేదు.", hi: "आपका खाता इस आयोजन की अतिथि सूची में नहीं है।" },
  noInvites: { en: "You have gallery access for this event. No RSVP is needed.", te: "మీకు ఈ ఈవెంట్ గ్యాలరీ యాక్సెస్ ఉంది. RSVP అవసరం లేదు.", hi: "आपके पास गैलरी एक्सेस है। RSVP की ज़रूरत नहीं है।" },
  saved: { en: "Thank you. Your response has been saved.", te: "ధన్యవాదాలు. మీ స్పందన సేవ్ అయింది.", hi: "धन्यवाद। आपका उत्तर सहेज लिया गया है।" },
  plusOne: { en: "Plus one", te: "అదనపు అతిథి", hi: "अतिरिक्त अतिथि" },
  firstName: { en: "First name", te: "పేరు", hi: "पहला नाम" },
  lastName: { en: "Last name", te: "ఇంటి పేరు", hi: "उपनाम" },
  chooseMeal: { en: "Choose a meal", te: "భోజనం ఎంచుకోండి", hi: "भोजन चुनें" },
  responding: { en: "Responding for", te: "ఎవరి కోసం స్పందిస్తున్నారు", hi: "किसके लिए उत्तर" },
  child: { en: "child", te: "పిల్లలు", hi: "बच्चा" },
  summary: { en: "Your responses", te: "మీ స్పందనలు", hi: "आपके उत्तर" },
};

export default async function RsvpPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  const theme = themeFor(event.theme);
  const intro = t(parsePage("RSVP", page(site, "RSVP")?.content).intro, locale);
  const { saved } = await searchParams;

  if (!viewer.guest) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={ui("rsvp", locale)} intro={intro} />
        <EmptyState title={ui("rsvp", locale)} body={t(STR.noGuestRow, locale)} />
      </div>
    );
  }

  const data = await loadHousehold(viewer.guest.householdId);
  if (!data || data.subEvents.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={ui("rsvp", locale)} intro={intro} />
        <EmptyState title={data?.household.name ?? ui("rsvp", locale)} body={t(STR.noInvites, locale)} />
      </div>
    );
  }

  const { household, subEvents } = data;
  const hasResponses = household.guests.some((g) => g.rsvps.some((r) => r.status !== "PENDING"));
  const nameOf = (g: (typeof household.guests)[number]) => fullName(g, t(STR.plusOne, locale));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={ui("rsvp", locale)} intro={intro}>
        <p className="mt-3 text-sm text-muted">
          {t(STR.responding, locale)}: <span className="font-medium text-fg">{household.name}</span>
        </p>
      </PageHeader>

      {saved && (
        <p role="status" className="card mb-6 border-accent px-5 py-4 text-center">
          {t(STR.saved, locale)}
        </p>
      )}

      {hasResponses && (
        <section className="card mb-8 p-5">
          <h2 className="eyebrow mb-3">{t(STR.summary, locale)}</h2>
          <ul className="space-y-2 text-sm">
            {subEvents.map((s) => {
              const rows = household.guests
                .filter((g) => g.invites.some((i) => i.subEventId === s.id))
                .map((g) => {
                  const r = g.rsvps.find((x) => x.subEventId === s.id);
                  const meal = r?.mealOptionId ? s.mealOptions.find((m) => m.id === r.mealOptionId) : null;
                  const status = r?.status ?? "PENDING";
                  return `${nameOf(g)}: ${status === "ATTENDING" ? ui("attending", locale) : status === "DECLINED" ? ui("declined", locale) : ui("pending", locale)}${meal ? ` (${t(meal.label as object, locale)})` : ""}`;
                });
              return (
                <li key={s.id}>
                  <span className="font-medium">{t(s.name as object, locale)}</span>
                  <span className="text-muted"> — {rows.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form action={submitRsvp} className="space-y-10">
        {household.guests.some((g) => g.isPlusOne) && (
          <fieldset className="card p-5">
            <legend className="eyebrow px-1">{t(STR.plusOne, locale)}</legend>
            {household.guests
              .filter((g) => g.isPlusOne)
              .map((g) => (
                <div key={g.id} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted">{t(STR.firstName, locale)}</span>
                    <input name={`name.${g.id}.first`} defaultValue={g.firstName ?? ""} className="input" />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted">{t(STR.lastName, locale)}</span>
                    <input name={`name.${g.id}.last`} defaultValue={g.lastName ?? ""} className="input" />
                  </label>
                </div>
              ))}
          </fieldset>
        )}

        {subEvents.map((s, i) => {
          const invited = household.guests.filter((g) => g.invites.some((inv) => inv.subEventId === s.id));
          return (
            <section key={s.id}>
              {i > 0 && <theme.Divider />}
              <h2 className="font-display text-2xl">{t(s.name as object, locale)}</h2>
              <p className="mb-4 text-sm text-muted">
                {fmtDateTime(s.startsAt, event.timezone, locale)}
                {s.venueName && ` · ${s.venueName}`}
              </p>
              <ul className="space-y-3">
                {invited.map((g) => {
                  const r = g.rsvps.find((x) => x.subEventId === s.id);
                  const field = `rsvp.${g.id}.${s.id}`;
                  return (
                    <li key={g.id} className="card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-medium">
                          {nameOf(g)}
                          {g.isChild && <span className="ml-2 text-xs uppercase tracking-wider text-muted">{t(STR.child, locale)}</span>}
                        </span>
                        <div className="flex gap-2" role="radiogroup" aria-label={nameOf(g)}>
                          {(["ATTENDING", "DECLINED"] as const).map((v) => (
                            <label key={v} className="cursor-pointer">
                              <input type="radio" name={field} value={v} defaultChecked={r?.status === v} className="peer sr-only" />
                              <span className="btn-ghost text-xs peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg">
                                {v === "ATTENDING" ? ui("attending", locale) : ui("declined", locale)}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      {s.servesMeal && s.mealOptions.length > 0 && (
                        <label className="mt-3 block text-sm">
                          <span className="mb-1 block text-muted">{ui("meal", locale)}</span>
                          <select name={`meal.${g.id}.${s.id}`} defaultValue={r?.mealOptionId ?? ""} className="input">
                            <option value="">{t(STR.chooseMeal, locale)}</option>
                            {s.mealOptions
                              .filter((m) => !m.isKidsMeal || g.isChild)
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {t(m.label as object, locale)}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <div className="flex justify-center">
          <button type="submit" className="btn min-w-48">
            {ui("save", locale)}
          </button>
        </div>
      </form>
    </div>
  );
}
