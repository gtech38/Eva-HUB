/**
 * Server-side consent rules for face search: did the person see the current text, may a face
 * profile be enrolled, and may face search run at all in this environment.
 */
import { consentRecordVersion, unreviewedConsentDocs, type ConsentDoc } from "@hub/shared/consent";
import { isLocale, type Locale } from "@hub/shared/i18n";

/**
 * "Remember my face" stays off until people can withdraw it themselves (account settings revoke,
 * WEB-006 / #7). While false the page hides the checkbox and the route ignores `remember`.
 */
export const FACE_PROFILE_ENROLMENT = false;

export type ConsentSubmission = {
  subject: string;
  /** `KIND:version` the client displayed. */
  consentVersion: string | null;
  /** Locale the client displayed the text in. */
  consentLocale: string | null;
  remember: boolean;
  /** `FACE_PROFILE:version` the client displayed next to "Remember my face". */
  profileConsentVersion: string | null;
};

export type ConsentCheck =
  | { ok: true; kind: "SEARCH_SELF" | "SEARCH_GUARDIAN"; locale: Locale; recordVersion: string; profileRequested: boolean }
  | { ok: false; reason: "consent_stale" };

const STALE = { ok: false, reason: "consent_stale" } as const;

/**
 * The consent the person ticked must be for the text that would be recorded now: same kind, same
 * version, a locale we ship. Anything else (including a missing field) is stale, so a deploy between
 * page load and submit can never record consent to words the person did not see.
 */
export function checkConsentSubmission(s: ConsentSubmission, opts: { profileEnrolment?: boolean } = {}): ConsentCheck {
  const kind = s.subject === "me" ? "SEARCH_SELF" : "SEARCH_GUARDIAN";
  if (!isLocale(s.consentLocale)) return STALE;
  const recordVersion = consentRecordVersion(kind);
  if (s.consentVersion !== recordVersion) return STALE;
  const profileRequested = (opts.profileEnrolment ?? FACE_PROFILE_ENROLMENT) && s.remember && kind === "SEARCH_SELF";
  if (profileRequested && s.profileConsentVersion !== consentRecordVersion("FACE_PROFILE")) return STALE;
  return { ok: true, kind, locale: s.consentLocale, recordVersion, profileRequested };
}

/** Profiles are for adult guests searching for themselves who asked for one. Never for a child. */
export function mayEnrolFaceProfile(input: { profileRequested: boolean; subjectGuestId: string | null; guest: { isChild: boolean } | null }): boolean {
  return input.profileRequested && !input.subjectGuestId && !!input.guest && !input.guest.isChild;
}

/** Production guard: no face search on consent texts counsel has not signed off (LEG-006). */
export function faceSearchAllowed(nodeEnv: string | undefined, unreviewed: Pick<ConsentDoc, "reviewedBy">[] = unreviewedConsentDocs()): boolean {
  return nodeEnv !== "production" || unreviewed.length === 0;
}
