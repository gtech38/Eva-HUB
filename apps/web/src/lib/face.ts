// tdd-exempt: type-only module. The consent text version lives in @hub/shared/consent (derived from legal/consent/*).

export type FaceSearchReason =
  | "unauthorized"
  | "forbidden"
  | "disabled"
  | "no_file"
  | "too_large"
  | "consent_required"
  | "consent_stale"
  | "opted_out"
  | "unavailable"
  | "no_face"
  | "multiple_faces"
  | "rate_limited"
  | string;
