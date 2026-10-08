import type { ConsentBlock } from "@hub/shared/consent";
import { LOCALE_NAMES } from "@hub/shared/i18n";
import { PageHeader, Card, Badge } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { consentCatalog } from "@/lib/legal";

export const dynamic = "force-dynamic";

/**
 * Read-only: every consent version bundled into this build. Label, summary and text are rendered from
 * the same blocks guests see (plain text, no HTML from the files).
 */
export default async function LegalPage() {
  await requirePlatformAdmin();
  const versions = consentCatalog();

  return (
    <>
      <PageHeader
        title="Legal: biometric consent texts"
        description={
          <>
            Consent rows store <span className="font-mono">KIND:version</span>. Source files live in <span className="font-mono">legal/consent/v&lt;N&gt;/</span>; changing any
            wording means a new version directory, never an edit (see its README). Older versions stay listed so any stored consent can be shown.
          </>
        }
        crumbs={[{ href: "/platform", label: "Platform" }, { label: "Legal" }]}
      />
      <div className="space-y-8">
        {versions.map((v) => (
          <section key={v.version} className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="font-mono">{v.version}</span>
              <span className="text-xs font-normal text-neutral-500">legal/consent/{v.dir}/</span>
              {v.current ? <Badge tone="green">current</Badge> : <Badge>superseded</Badge>}
            </h2>
            {v.kinds.map((k) => (
              <Card key={k.recordVersion} title={<span className="font-mono">{k.recordVersion}</span>}>
                <div className="space-y-2">
                  {k.texts.map(({ doc: d, blocks }) => (
                    <details key={d.locale} className="rounded border border-neutral-200 px-3 py-2">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{LOCALE_NAMES[d.locale]}</span>
                        <span className="text-xs text-neutral-500">effective {d.effective}</span>
                        <Badge tone="amber" title={d.status}>
                          {d.status}
                        </Badge>
                        <Badge tone={d.reviewedBy ? "green" : "neutral"}>{d.reviewedBy ? `reviewed by ${d.reviewedBy}` : "not reviewed"}</Badge>
                        {d.translation && <Badge tone="purple">{d.translation}</Badge>}
                      </summary>
                      <div lang={d.locale} className="mt-3 space-y-3 text-[13px] leading-relaxed text-neutral-800">
                        <p>
                          <span className="text-xs uppercase tracking-wide text-neutral-500">Checkbox</span>
                          <br />
                          <span className="font-medium">{d.label}</span>
                          <br />
                          <span className="text-neutral-600">{d.summary}</span>
                        </p>
                        <Blocks blocks={blocks} />
                      </div>
                    </details>
                  ))}
                </div>
              </Card>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function Blocks({ blocks }: { blocks: ConsentBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <h3 key={i} className="pt-1 font-semibold">
            {b.text}
          </h3>
        ) : b.type === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </>
  );
}
