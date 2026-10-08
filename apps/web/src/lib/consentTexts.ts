import "server-only";
import { consentBlocks, consentRecordVersion, consentText, type ConsentKind } from "@hub/shared/consent";
import type { Locale } from "@hub/shared/i18n";
import type { ConsentTexts, ConsentView } from "./consentView";

const view = (kind: ConsentKind, locale: Locale): ConsentView => {
  const doc = consentText(kind, locale);
  return { label: doc.label, summary: doc.summary, blocks: consentBlocks(doc.body), version: consentRecordVersion(kind, doc.version), locale };
};

/** Server-side: the three current consent texts for /gallery/me in the viewer's locale. */
export function consentTextsFor(locale: Locale): ConsentTexts {
  return { self: view("SEARCH_SELF", locale), guardian: view("SEARCH_GUARDIAN", locale), profile: view("FACE_PROFILE", locale) };
}
