import {
  CONSENT_KINDS,
  CONSENT_VERSIONS,
  CURRENT_CONSENT_VERSION,
  consentBlocks,
  consentRecordVersion,
  type ConsentBlock,
  type ConsentDoc,
  type ConsentKind,
} from "@hub/shared/consent";
import { LOCALES } from "@hub/shared/i18n";

export type ConsentCatalogVersion = {
  dir: string;
  version: string;
  current: boolean;
  kinds: Array<{ kind: ConsentKind; recordVersion: string; texts: Array<{ doc: ConsentDoc; blocks: ConsentBlock[] }> }>;
};

/** Read-only view of every bundled consent version (newest first) for /platform/legal. */
export function consentCatalog(): ConsentCatalogVersion[] {
  return [...CONSENT_VERSIONS].reverse().map((v) => ({
    dir: v.dir,
    version: v.version,
    current: v.version === CURRENT_CONSENT_VERSION,
    kinds: CONSENT_KINDS.map((kind) => ({
      kind,
      recordVersion: consentRecordVersion(kind, v.version),
      texts: LOCALES.map((locale) => {
        const doc = v.docs[kind][locale];
        return { doc, blocks: consentBlocks(doc.body) };
      }),
    })),
  }));
}
