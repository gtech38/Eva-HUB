// tdd-exempt: route shell; availability, undo window and link safety are tested in lib/registry.test.ts and lib/registryClaims.test.ts
import { notFound } from "next/navigation";
import { parsePage } from "@hub/shared/pages";
import { t, ui } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { ClaimControls } from "@/components/registry/ClaimControls";
import { CopyButton } from "@/components/registry/CopyButton";
import { registryItemView, safeExternalUrl } from "@/lib/registry";
import { loadRegistry } from "@/lib/registryClaims";

export const dynamic = "force-dynamic";

export default async function RegistryPage() {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  const row = page(site, "REGISTRY");
  if (!row) notFound();

  const intro = t(parsePage("REGISTRY", row.content).intro, locale);
  const { items, funds } = await loadRegistry(event.id);
  const now = new Date();
  const userId = viewer.principal.userId;
  const canClaim = viewer.can("registry.claim");
  const strings = {
    markPurchased: ui("markPurchased", locale),
    youPurchased: ui("youPurchased", locale),
    fullyPurchased: ui("fullyPurchased", locale),
    undo: ui("undo", locale),
    quantity: ui("quantity", locale),
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={ui("registry", locale)} intro={intro} />

      {items.length === 0 && funds.length === 0 ? (
        <EmptyState title={ui("registryEmpty", locale)} body={ui("checkBackSoon", locale)} />
      ) : (
        <>
          {items.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {items.map((item) => {
                const view = registryItemView(item, item.claims, userId, now);
                const href = safeExternalUrl(item.url);
                const image = safeExternalUrl(item.imageUrl, { httpsOnly: true });
                const title = t(item.title as object, locale);
                return (
                  <li key={item.id} className="card flex flex-col p-5" data-testid="registry-item">
                    {image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt="" loading="lazy" className="mb-4 aspect-[4/3] w-full rounded-theme object-cover" />
                    )}
                    <h2 className="font-display text-2xl">{title}</h2>
                    {item.storeName && <p className="mt-1 text-sm text-muted">{item.storeName}</p>}
                    {item.quantity > 1 && (
                      <p className="mt-1 text-sm text-muted" data-testid="still-needed">
                        {ui("stillNeeded", locale)}: {view.remaining} / {item.quantity}
                      </p>
                    )}
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 text-sm underline underline-offset-4">
                        {ui("viewItem", locale)}
                      </a>
                    )}
                    <ClaimControls
                      itemId={item.id}
                      itemTitle={title}
                      remaining={view.remaining}
                      canClaim={canClaim}
                      purchasedByViewer={view.purchasedByViewer}
                      undoableClaims={view.undoableClaims}
                      strings={strings}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {funds.length > 0 && (
            <section className="mt-12" aria-labelledby="cash-gifts">
              <h2 id="cash-gifts" className="mb-4 text-center font-display text-3xl">
                {ui("cashGifts", locale)}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {funds.map((fund) => (
                  <li key={fund.id} className="card p-5" data-testid="cash-fund">
                    <h3 className="font-display text-2xl">{t(fund.title as object, locale)}</h3>
                    {fund.description != null && <p className="mt-2 text-sm text-muted">{t(fund.description as object, locale)}</p>}
                    {fund.kind === "EXTERNAL" && fund.externalHandle && (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <code className="rounded-theme bg-surface px-3 py-1.5 text-sm">{fund.externalHandle}</code>
                        <CopyButton text={fund.externalHandle} label={ui("copy", locale)} doneLabel={ui("copied", locale)} />
                      </div>
                    )}
                    {fund.kind === "STRIPE" && (
                      <div className="mt-4 flex items-center gap-3">
                        <button type="button" className="btn opacity-60" disabled aria-disabled="true">
                          {ui("contribute", locale)}
                        </button>
                        <span className="text-xs text-muted">{ui("comingSoon", locale)}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
