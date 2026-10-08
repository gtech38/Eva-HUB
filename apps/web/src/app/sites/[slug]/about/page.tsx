import { notFound } from "next/navigation";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { storage } from "@hub/shared";
import { requireViewer, page } from "@/lib/site";
import { PageHeader } from "@/components/PageHeader";
import { themeFor } from "@/themes";

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const site = await requireViewer();
  if (!site) return null;
  const row = page(site, "ABOUT");
  if (!row) notFound();
  const about = parsePage("ABOUT", row.content);
  const theme = themeFor(site.event.theme);
  const photos = await Promise.all(about.photoKeys.map((k) => storage.derivativeUrl(k)));
  const paragraphs = t(about.story, site.locale).split(/\n{2,}/).filter(Boolean);

  return (
    <article className="mx-auto max-w-2xl">
      <PageHeader title={ui("about", site.locale)} />
      <theme.Divider />
      <div className="prose-site text-lg leading-relaxed">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {photos.length > 0 && (
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="aspect-[4/5] w-full rounded-theme object-cover" />
          ))}
        </div>
      )}
    </article>
  );
}
