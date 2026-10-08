import { consentBlocks, consentRecordVersion, consentText, type ConsentBlock, type ConsentKind } from "@hub/shared/consent";
import type { Locale } from "@hub/shared/i18n";

/** One consent text as the client renders it; `version` is what BiometricConsent stores. */
export type ConsentView = { blocks: ConsentBlock[]; version: string };
export type ConsentTexts = { self: ConsentView; guardian: ConsentView; profile: ConsentView };

const view = (kind: ConsentKind, locale: Locale): ConsentView => ({
  blocks: consentBlocks(consentText(kind, locale).body),
  version: consentRecordVersion(kind),
});

/** Server-side: the three consent texts for /gallery/me in the viewer's locale. */
export function consentTextsFor(locale: Locale): ConsentTexts {
  return { self: view("SEARCH_SELF", locale), guardian: view("SEARCH_GUARDIAN", locale), profile: view("FACE_PROFILE", locale) };
}
