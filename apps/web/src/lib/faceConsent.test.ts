import { describe, expect, it } from "vitest";
import { consentText } from "@hub/shared/consent";
import { FACE_PROFILE_ENROLMENT, checkConsentSubmission, faceSearchAllowed, mayEnrolFaceProfile } from "./faceConsent";

const self = { subject: "me", consentVersion: "SEARCH_SELF:v1-2026-10", consentLocale: "te", remember: false, profileConsentVersion: null };

describe("checkConsentSubmission", () => {
  it("accepts the current self text in a known locale", () => {
    expect(checkConsentSubmission(self)).toStrictEqual({
      ok: true,
      kind: "SEARCH_SELF",
      locale: "te",
      recordVersion: "SEARCH_SELF:v1-2026-10",
      profileRequested: false,
    });
  });

  it("a child subject needs the guardian text", () => {
    expect(checkConsentSubmission({ ...self, subject: "guest-1", consentVersion: "SEARCH_GUARDIAN:v1-2026-10" })).toMatchObject({ ok: true, kind: "SEARCH_GUARDIAN" });
    expect(checkConsentSubmission({ ...self, subject: "guest-1" })).toStrictEqual({ ok: false, reason: "consent_stale" });
  });

  it("is stale when the version is missing, old, or for another kind", () => {
    for (const consentVersion of [null, "", "v1-2026-10", "SEARCH_SELF:v0-1999-01", "SEARCH_GUARDIAN:v1-2026-10"]) {
      expect(checkConsentSubmission({ ...self, consentVersion })).toStrictEqual({ ok: false, reason: "consent_stale" });
    }
  });

  it("is stale when the locale is missing or not one we ship", () => {
    for (const consentLocale of [null, "", "fr"]) {
      expect(checkConsentSubmission({ ...self, consentLocale })).toStrictEqual({ ok: false, reason: "consent_stale" });
    }
  });

  it("ignores remember while face-profile enrolment is off", () => {
    expect(FACE_PROFILE_ENROLMENT).toBe(false);
    expect(checkConsentSubmission({ ...self, remember: true })).toMatchObject({ ok: true, profileRequested: false });
  });

  it("with enrolment on, remember needs the current face-profile text version", () => {
    const on = { profileEnrolment: true };
    expect(checkConsentSubmission({ ...self, remember: true, profileConsentVersion: "FACE_PROFILE:v1-2026-10" }, on)).toMatchObject({ ok: true, profileRequested: true });
    expect(checkConsentSubmission({ ...self, remember: true, profileConsentVersion: null }, on)).toStrictEqual({ ok: false, reason: "consent_stale" });
    // A guardian search never requests a profile, whatever the form says.
    expect(
      checkConsentSubmission({ ...self, subject: "guest-1", consentVersion: "SEARCH_GUARDIAN:v1-2026-10", remember: true, profileConsentVersion: "FACE_PROFILE:v1-2026-10" }, on),
    ).toMatchObject({ ok: true, profileRequested: false });
  });
});

describe("mayEnrolFaceProfile", () => {
  const adult = { isChild: false };

  it("only an adult guest searching for themselves who asked for it", () => {
    expect(mayEnrolFaceProfile({ profileRequested: true, subjectGuestId: null, guest: adult })).toBe(true);
    expect(mayEnrolFaceProfile({ profileRequested: false, subjectGuestId: null, guest: adult })).toBe(false);
  });

  it("never for a guardian search, a child viewer, or a viewer without a guest row", () => {
    expect(mayEnrolFaceProfile({ profileRequested: true, subjectGuestId: "guest-child", guest: adult })).toBe(false);
    expect(mayEnrolFaceProfile({ profileRequested: true, subjectGuestId: null, guest: { isChild: true } })).toBe(false);
    expect(mayEnrolFaceProfile({ profileRequested: true, subjectGuestId: null, guest: null })).toBe(false);
  });
});

describe("faceSearchAllowed (production guard)", () => {
  const reviewed = [{ ...consentText("SEARCH_SELF", "en"), reviewedBy: "Counsel LLP" }];

  it("is off in production while any current consent text is unreviewed", () => {
    expect(faceSearchAllowed("production")).toBe(false);
  });

  it("is on in production once every current text is reviewed", () => {
    expect(faceSearchAllowed("production", [])).toBe(true);
    expect(faceSearchAllowed("production", reviewed.filter((d) => !d.reviewedBy))).toBe(true);
  });

  it("is on outside production so drafts can be developed and tested", () => {
    expect(faceSearchAllowed("development")).toBe(true);
    expect(faceSearchAllowed("test")).toBe(true);
    expect(faceSearchAllowed(undefined)).toBe(true);
  });
});
