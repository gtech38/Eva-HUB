# Biometric consent texts

These files are the exact words a person agrees to before face search runs. They are bundled into
the web and admin apps at build time by `packages/shared/src/consent.ts` (`?raw` imports), which
also derives the version stored on every `BiometricConsent` row:
`consentTextVersion = "<KIND>:<version>"`, e.g. `SEARCH_SELF:v1-2026-10`. There is no other copy
of this text and no other version constant.

## Layout

```
legal/consent/v<N>/<kind>.<locale>.md
```

| File stem | `ConsentKind` | Shown when |
|---|---|---|
| `search_self` | `SEARCH_SELF` | someone searches for their own photos with a selfie |
| `search_guardian` | `SEARCH_GUARDIAN` | an adult searches on behalf of a child guest in their household |
| `face_profile` | `FACE_PROFILE` | the optional "Remember my face" box is ticked (hidden until WEB-006 ships revoke) |

Locales: `en`, `te`, `hi`. Every kind must exist in every locale; `consent.test.ts` fails otherwise,
and also fails if a file is wired into the wrong (kind, locale) slot.

## Front matter

```
---
version: v1-2026-10          # identical in every file of the directory, unique across directories
effective: 2026-10-08        # date this version is first shown
kind: SEARCH_SELF            # ConsentKind; must match the file name
locale: en                   # must match the file name
status: DRAFT — pending attorney review (LEG-006)
reviewed_by:                 # empty until counsel signs off (LEG-006)
translation: machine-drafted, pending native review   # te/hi only, until a native speaker reviews
label: I agree to a one-time face search for myself   # checkbox label (guardian: the attestation)
summary: One or two sentences shown under the checkbox.
---
```

`label` and `summary` are part of the versioned text: the checkbox shows them verbatim, so they are
covered by the version like the body is.

Body: plain markdown subset only -- `## headings`, `- bullet` lists and paragraphs. No inline
formatting, links or HTML; the apps render it as text.

## Production guard

While any file of the **current** version has an empty `reviewed_by`, face search is disabled when
`NODE_ENV=production` (route answers `disabled`, the page hides face search). Development and test
are unaffected. Setting `reviewed_by` is the switch, so it may only be filled in by LEG-006.

## The rule: never edit a published version

**Changing any wording, in any locale -- body, label or summary -- requires a new version directory
(`v2/`, `v3/`, ...). Never edit the files of a version once it has been shown to users.** Consent
rows point at a version; if the words under that version change, the platform can no longer show
what a person actually agreed to (Texas CUBI, docs/01 §6).

To publish a new version:

1. Copy the current directory (e.g. `v1/`) to `v2/` and edit the copies. Set `version:` in all
   nine files to a new value (e.g. `v2-2027-03`) and update `effective:`.
2. In `packages/shared/src/consent.ts`, add nine `?raw` imports for `v2/`, append a `{ dir: "v2", raw }`
   entry to `BUNDLED`, and set `CURRENT_DIR = "v2"`.
3. Keep `v1/` and its `BUNDLED` entry forever: `consentText(kind, locale, "v1-2026-10")` must keep
   working so any stored consent can be shown, and `/platform/legal` lists every version.
4. Run `pnpm --filter @hub/shared test`. It fails if a directory on disk is not bundled, a file is
   missing or mis-wired, or the versions in a directory disagree.

Clients post the `KIND:version` and locale they displayed; after a deploy that changes
`CURRENT_DIR`, pages loaded before the deploy get `409 consent_stale` and reload the new text.

Front-matter-only corrections that do not change what the user reads (filling in `reviewed_by` after
LEG-006, or clearing the `translation` flag after native review) may be made in place.

## Status

v1 is a plain-language **draft pending attorney review (LEG-006)** and describes only what the
product does today: no self-service withdrawal yet (requests go to the studio), no automated
purges, no face-profile notifications. The Telugu and Hindi texts are machine-drafted and pending
native-speaker review.
