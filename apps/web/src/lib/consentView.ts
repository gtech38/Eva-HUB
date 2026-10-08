/**
 * Client-safe consent view model: types and pure selection only. Type-only imports keep the consent
 * texts themselves (`@hub/shared/consent`) out of client bundles; `consentTexts.ts` builds the views
 * on the server.
 */
import type { ConsentBlock } from "@hub/shared/consent";
import type { Locale } from "@hub/shared/i18n";

/**
 * One consent text as the client renders it. `version` (`KIND:version`) and `locale` are posted
 * back with the search so the route can prove which words were shown.
 */
export type ConsentView = { label: string; summary: string; blocks: ConsentBlock[]; version: string; locale: Locale };
export type ConsentTexts = { self: ConsentView; guardian: ConsentView; profile: ConsentView };

/** Which text applies to a search subject: "me" is a self search, anything else is a child guest. */
export function consentFor(subject: string, texts: ConsentTexts): ConsentView {
  return subject === "me" ? texts.self : texts.guardian;
}
