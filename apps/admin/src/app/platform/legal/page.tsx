import { LOCALE_NAMES } from "@hub/shared/i18n";
import { PageHeader, Card, Badge } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { consentCatalog } from "@/lib/legal";

export const dynamic = "force-dynamic";

/** Read-only: the consent texts bundled into this build, exactly as guests see them. */
export default async function LegalPage() {
  await requirePlatformAdmin();
  const { version, kinds } = consentCatalog();

  return (
    <>
      <PageHeader
        title="Legal: biometric consent texts"
        description={
          <>
            Current version <span className="font-mono">{version}</span>. Consent rows store <span className="font-mono">KIND:version</span>. Source files live in{" "}
            <span className="font-mono">legal/consent/</span>; changing any wording means a new version directory, never an edit (see its README).
          </>
        }
        crumbs={[{ href: "/platform", label: "Platform" }, { label: "Legal" }]}
      />
      <div className="space-y-4">
        {kinds.map((k) => (
          <Card key={k.kind} title={<span className="font-mono">{k.recordVersion}</span>}>
            <div className="space-y-2">
              {k.texts.map((d) => (
                <details key={d.locale} className="rounded border border-neutral-200 px-3 py-2">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{LOCALE_NAMES[d.locale]}</span>
                    <span className="text-xs text-neutral-500">effective {d.effective}</span>
                    <Badge tone="amber" title={d.status}>{d.status}</Badge>
                    <Badge tone={d.reviewedBy ? "green" : "neutral"}>{d.reviewedBy ? `reviewed by ${d.reviewedBy}` : "not reviewed"}</Badge>
                    {d.translation && <Badge tone="purple">{d.translation}</Badge>}
                  </summary>
                  <pre lang={d.locale} className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-neutral-800">
                    {d.body}
                  </pre>
                </details>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
