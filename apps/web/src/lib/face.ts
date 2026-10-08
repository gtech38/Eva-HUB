/** Version of the consent copy shown on /gallery/me. Bump when the wording changes. */
export const CONSENT_TEXT_VERSION = "v1-2026-10";

export type FaceSearchReason =
  | "unauthorized"
  | "forbidden"
  | "disabled"
  | "no_file"
  | "too_large"
  | "consent_required"
  | "opted_out"
  | "unavailable"
  | "no_face"
  | "multiple_faces"
  | string;
