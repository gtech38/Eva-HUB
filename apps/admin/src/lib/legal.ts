import { CONSENT_KINDS, CONSENT_TEXT_VERSION, consentRecordVersion, consentText, type ConsentDoc, type ConsentKind } from "@hub/shared/consent";
import { LOCALES } from "@hub/shared/i18n";

export type ConsentCatalog = {
  version: string;
  kinds: Array<{ kind: ConsentKind; recordVersion: string; texts: ConsentDoc[] }>;
};

/** Read-only view of the bundled consent texts for /platform/legal. */
export function consentCatalog(): ConsentCatalog {
  return {
    version: CONSENT_TEXT_VERSION,
    kinds: CONSENT_KINDS.map((kind) => ({
      kind,
      recordVersion: consentRecordVersion(kind),
      texts: LOCALES.map((locale) => consentText(kind, locale)),
    })),
  };
}
