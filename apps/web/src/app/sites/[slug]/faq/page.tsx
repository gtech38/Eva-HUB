import { notFound } from "next/navigation";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function FaqPage() {
  const site = await requireViewer();
  if (!site) return null;
  const row = page(site, "FAQ");
  if (!row) notFound();
  const { locale } = site;
  const faq = parsePage("FAQ", row.content);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={ui("faq", locale)} />
      <dl className="divide-y divide-line card">
        {faq.items.map((it, i) => (
          <details key={i} className="group px-5 py-4">
            <summary className="cursor-pointer list-none font-display text-xl marker:hidden">
              <span className="flex items-center justify-between gap-4">
                {t(it.q, locale)}
                <span className="text-muted transition group-open:rotate-45" aria-hidden>
                  +
                </span>
              </span>
            </summary>
            <dd className="mt-3 text-base text-muted">{t(it.a, locale)}</dd>
          </details>
        ))}
      </dl>
    </div>
  );
}
