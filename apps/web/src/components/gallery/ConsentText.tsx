import type { ConsentView } from "@/lib/consentView";

/**
 * Full consent text behind a disclosure, as plain text (the files never contribute HTML).
 * `version` is the exact value stored on the BiometricConsent row.
 */
export function ConsentText({ summary, versionLabel, text, testId }: { summary: string; versionLabel: string; text: ConsentView; testId: string }) {
  return (
    <details className="mt-2 pl-7 text-sm" data-testid={testId}>
      <summary className="cursor-pointer underline underline-offset-4 hover:opacity-70">{summary}</summary>
      <div className="mt-3 space-y-3 rounded-theme border border-line bg-bg px-4 py-3 text-muted">
        {text.blocks.map((b, i) =>
          b.type === "heading" ? (
            <h3 key={i} className="pt-1 font-medium text-fg">
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
        <p className="pt-1 text-xs">
          {versionLabel}: <span className="font-mono">{text.version}</span>
        </p>
      </div>
    </details>
  );
}
