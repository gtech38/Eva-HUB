# Biometric consent texts

These files are the exact words a person agrees to before face search runs. They are bundled into
the web and admin apps at build time by `packages/shared/src/consent.ts`, which also derives the
version stored on every `BiometricConsent` row (`consentTextVersion = "<KIND>:<version>"`, e.g.
`SEARCH_SELF:v1-2026-10`). There is no other copy of this text and no other version constant.

## Layout

```
legal/consent/<version-dir>/<kind>.<locale>.md
```

| File stem | `ConsentKind` | Shown when |
|---|---|---|
| `search_self` | `SEARCH_SELF` | an adult or teen searches for their own photos with a selfie |
| `search_guardian` | `SEARCH_GUARDIAN` | an adult searches on behalf of a child guest in their household |
| `face_profile` | `FACE_PROFILE` | the optional "Remember my face" box is ticked |

Locales: `en`, `te`, `hi`. Every kind must exist in every locale (`consent.test.ts` fails otherwise).

## Front matter

```
---
version: v1-2026-10          # identical in every file of the directory
effective: 2026-10-08        # date this version is first shown
kind: SEARCH_SELF            # ConsentKind
locale: en
status: DRAFT — pending attorney review (LEG-006)
reviewed_by:                 # empty until counsel signs off (LEG-006)
translation: machine-drafted, pending native review   # te/hi only, until a native speaker reviews
---
```

Body: plain markdown subset only -- `## headings`, `- bullet` lists and paragraphs. No inline
formatting, links or HTML; the apps render it as text.

## The rule: never edit a published version

**Changing any wording, in any locale, requires a new version directory (`v2/`, `v3/`, ...). Never
edit the files in an existing version directory once it has been shown to users.** Consent rows
point at a version; if the words under that version change, the platform can no longer show what a
person actually agreed to (Texas CUBI, docs/01 §6).

To publish a new version:

1. Copy `v1/` to `v2/` and edit the copies. Set `version:` in all nine files to the new value
   (e.g. `v2-2027-03`) and update `effective:`.
2. Point the nine `?raw` imports in `packages/shared/src/consent.ts` and the `V1` path in
   `consent.test.ts` at `v2/`.
3. Keep `v1/` in the repository forever; it is the record of what earlier consents covered.
4. Run `pnpm --filter @hub/shared test`. The test fails if a file is missing or the versions in
   the directory disagree.

Front-matter-only corrections that do not change what the user reads (for example filling in
`reviewed_by` after LEG-006, or clearing the `translation` flag after native review) may be made in
place.

## Status

v1 is a plain-language **draft pending attorney review (LEG-006)**. The Telugu and Hindi texts are
machine-drafted and pending native-speaker review. Legal correctness is out of scope for LEG-001.
