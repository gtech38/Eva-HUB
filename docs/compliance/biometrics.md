# Biometric compliance checklist (Texas CUBI, COPPA)

**Ticket:** LEG-005 · **Describes:** `dev` at commit `43aafbd` (2026-10-08) · **Owner of legal conclusions:** LEG-006 (attorney review)

This is an engineering record. For each requirement it says what the code does today and where to
look for proof. It is **not** a statement that the platform complies with CUBI or COPPA, and it makes
no legal conclusion. Where a reading of the law decides the outcome the row is tagged **[COUNSEL]**
and the question is collected in section 6 for LEG-006.

Two facts frame everything below:

1. **Face search is switched off in production today.** `faceSearchAllowed()`
   (`apps/web/src/lib/faceConsent.ts`) returns false when `NODE_ENV=production` while any consent
   file of the current version has an empty `reviewed_by` (`legal/consent/README.md`, "Production
   guard"). Every consent file is a draft pending LEG-006. The gaps below must be closed or accepted
   by counsel before that guard is lifted.
2. **The statements the platform makes to people are the consent texts** in `legal/consent/v1/`. A
   control only counts if those words are true, so section 2 checks the words against the code.

Status values: **Implemented** (code does it, evidence given), **Partial** (some of it, gap stated),
**Not implemented** (no code), **External** (depends on hosting, contracts or documents outside this
repo; nothing here proves it).

## 1. Where biometric data lives

| Data | Where | Biometric? | Created by | Removed by |
|---|---|---|---|---|
| Face embeddings of everyone in a gallery photo | `Face.embedding` (`vector(128)`), plus `bbox`, `quality` | Yes | `INDEX_FACES` (`workers/media/hub_worker/handlers/index_faces.py`) | `PURGE_FACE_INDEX`, photo delete (FK cascade) |
| Groups of those faces | `FaceCluster` (`label`, `suppressed`) | Derived from the above; purged with it | `CLUSTER_FACES` | `PURGE_FACE_INDEX` |
| Searcher's selfie | request body, in transit only | Image of a face | Guest, `POST /api/face/search` | Not stored by our code; see limitation L9 |
| Searcher's embedding | in memory in the route for one SQL query | Yes | `POST /embed-selfie` | Discarded after the query unless a profile is saved |
| "Remember my face" profile | `FaceProfile.embedding` | Yes | Search route, only when `FACE_PROFILE_ENROLMENT` is true (it is `false`) | Nothing in the product yet (C7); an operator can delete it with the runbook section 2.2 SQL |
| Search results | `PhotoMatch` (photo id, user or guest id, score) | No (by design, `docs/01` §6) | Search route, `CLUSTER_FACES` profile matching | Survives the purge; person-level delete is manual (runbook section 2) |
| Proof of consent | `BiometricConsent` (kind, who, child guest, event, `consentTextVersion`, `ipHash`, timestamps) | No | Search route | Never (it is evidence) |
| Everything above, as of backup time | Postgres backups and PITR | Yes (embeddings) | Backup jobs (DOC-003) | Backup expiry; see `docs/ops/backups.md` |

A search of `apps/` and `packages/shared/` for `embedding` finds only the search route, its test and
one help string in the admin settings page: no page, API or export returns an embedding.

## 2. Do the consent texts match the code?

Checked against `legal/consent/v1/*.en.md` (the te/hi files are machine-drafted translations of the
same text and carry the same claims).

| Claim in the text | True today? | Evidence / gap |
|---|---|---|
| "Your selfie is processed temporarily ... then deleted. It is never saved." | Mostly. Our code never writes it. The worker's multipart parser spools uploads over 1 MB to a temp file that the library deletes afterwards, so "never written anywhere" (the `api.py` docstring) is not literally right. | `docs/01` §6 already says "not strictly in memory". **[COUNSEL]** whether "never saved" needs rewording. A wording change means a new consent version directory. |
| "The face signature from your selfie is used for this one search and then deleted." | Yes. The route holds it in a local variable for one SQL query. | `apps/web/src/app/api/face/search/route.ts` |
| "You only see photos you are already allowed to see." | Yes. The match list goes through `visiblePhotoWhere` before anything is returned or saved. | same route, step 3 |
| "The studio's retention policy sets how long [the face index] is kept ... after which it is to be deleted." | **No, not automatically.** The date is computed (`Event.faceIndexPurgeAt`) but nothing enqueues the purge when it passes; only an admin pressing "Purge face index now" does. | WRK-012 (scheduler). Gap G1. |
| "The studio can delete it earlier." | Yes. | Admin `purgeFaceIndexNow` (`apps/admin/.../events/[eventId]/actions.ts`), gated by `can("event.settings")`. |
| "We never sell, rent or trade ... and do not share it with the event hosts or other guests." | Yes for hosts and guests: no endpoint returns embeddings. Third parties: no biometric API is called; models run in our worker. Hosting, storage and backup providers hold the data, and no processor list exists yet. | Gap G8 (LEG-003). |
| "Face search only runs when you take a selfie. If you do not, nothing is collected from you." (also "... nothing is collected from the child") | **No.** Face signatures of everyone in the gallery's photos are computed whether or not they ever search. A person who never opens face search has had face geometry collected. | C3, L1. The same section of both search texts must be reworded before launch **[COUNSEL]**; that needs a new consent version. |
| "We record that you agreed, when, which version of this text you saw, and in which language." (guardian: "who you are, which child") | **Partly.** The row is written only when a search completes, so a failed attempt after a processed selfie has no record (G2). The locale is not on the row, only in `AuditLog.data` of `face.search` (DB-005). | WEB-040, DB-005 |
| "To ask that your face be excluded ... contact the studio. Self-service controls ... are not available yet." | True. This is the honest version. | The invitation email says the opposite; see limitation L2. |
| "a one-time face search **for myself**" / "I am this child's parent or legal guardian" | **Unchecked.** Nothing verifies that the uploaded selfie shows the searcher, or that a forwarded invitation link is used by the invitee. | L12, P7, WEB-041, SHR-026 |
| FACE_PROFILE: "delete a face profile no later than 3 years after you last saved it" | Not enforced. No profile purge exists. Enrolment is switched off, so no profile is created. | WRK-012, WRK-010, WEB-029. See C7. |

## 3. Texas CUBI (Bus. & Com. Code §503.001)

The requirement column paraphrases the position `docs/01` §6 commits to (consent before capture, no
sale or disclosure, reasonable care, destruction within a reasonable time and no later than one year
after the purpose expires). **[COUNSEL]**: confirm the statutory text and exceptions; this file does
not interpret them.

| # | Requirement | Control in the code | Status | Evidence | Gap / ticket |
|---|---|---|---|---|---|
| C1 | Informed consent **before** capture, for searchers | Checkbox plus the full versioned text is shown before the selfie. The route refuses a missing tick (`consent_required`) and any submission whose `KIND:version` or locale is not the current text (`409 consent_stale`) **before** the selfie is sent to the worker. A `BiometricConsent` row stores `consentTextVersion` (e.g. `SEARCH_SELF:v1-2026-10`), `consentedByUserId`, `subjectGuestId`, `eventId`, `ipHash`. | **Partial** | `apps/web/src/lib/faceConsent.ts` (`checkConsentSubmission`); route `POST` steps before "1. Embed"; `packages/shared/src/consent.ts`; `legal/consent/v1/`; table `BiometricConsent` (`schema.prisma`) | The row is written **after** the selfie has been embedded and matched, in the final transaction, and only when that succeeds. A `no_face`, worker-down or query failure processes a selfie and leaves no consent row (G2, WEB-040). Locale is only in `AuditLog.data` (DB-005). |
| C2 | Consent text is accurate | See section 2. | **Partial** | `legal/consent/README.md` | Retention claim not backed by a scheduler (G1); "never saved" wording **[COUNSEL]**. All drafts: `reviewed_by` empty (LEG-006). |
| C3 | Consent for people whose faces are indexed but who never search | None. Every face in every READY photo is embedded when `Event.faceSearchEnabled` is true. Mitigations are host-side: the invitation footer, a host agreement, notices. | **Not implemented** (mitigated only by notices) | `index_faces.py`; invitation footer in `apps/admin/src/lib/invites.ts` | **[COUNSEL]** whether computing a face embedding for these people is capture of a biometric identifier needing consent, and whether notice plus host agreement is enough. Host agreement does not exist yet (LEG-002); RSVP-page and gallery notices from `docs/01` §6 are not in the code; the invitation footer promises an opt-out control that does not exist (L2, WEB-021). |
| C4 | No sale, lease or disclosure | Stated in all consent texts. Technically: self-hosted YuNet and SFace in our worker, no third-party face API; embeddings are only readable by the search route (event-scoped query) and the worker; hosts, guests and studio staff UIs show none. | **Partial** | `workers/media/hub_worker/face.py`; section 1 note on `embedding` | No processor/sub-processor list (hosting, storage, backups) and no privacy policy yet: G8, LEG-003. Disclosure "if the law requires" is unspecified. |
| C5 | Reasonable care in storing and protecting | **In transit:** local dev is plain HTTP; production TLS is designed (Caddy, INF-018) but not built; the web-to-worker call is internal HTTP; the worker API has no authentication and binds `0.0.0.0` (`__main__.py`), so it relies on network isolation (INF-018: "worker is not exposed"). **At rest:** provider feature, not configured in this repo. **Access:** all face queries filter on `eventId` in application code; `Face` has no `studioId` column. **Row-level security:** none in any migration. | **External / Partial** | `infra/`, `docs/01` §3 and §6; migrations (no `ROW LEVEL SECURITY` anywhere) | G6: encryption at rest and in transit must be verified per environment and written down (DOC-020). RLS is DB-004 (Phase 3). Backup encryption: `docs/ops/backups.md` §6. |
| C6 | Destroy event face data within a reasonable time, at most 1 year after the purpose expires | Retention window per studio (default 365) with per-event override, both validated 30-730 days **in the admin form code only** (Zod `Retention`; no DB CHECK). `Event.faceIndexPurgeAt = galleryPublishedAt + window`, recomputed when settings change. `PURGE_FACE_INDEX` deletes `Face` and `FaceCluster`, clears `Photo.facesIndexedAt`, stamps `Event.faceIndexPurgedAt`, drops the queued cluster job and writes `AuditLog faceindex.purge`. | **Partial: the mechanism works, the trigger does not** | `workers/media/hub_worker/handlers/purge_face_index.py`; `workers/media/tests/test_purge_face_index.py`; `apps/admin/.../events/[eventId]/actions.ts`; `scripts/compliance/verify-purge.mjs` | G1: nothing runs the purge at `faceIndexPurgeAt` (WRK-012). G3: `faceIndexPurgeAt` is NULL until the gallery is published, though indexing starts at upload (WRK-021). G4: `INDEX_FACES` ignores `faceIndexPurgedAt`, so a photo uploaded or reprocessed after a purge is indexed again with no new purge date, and switching face search off does not delete an existing index (WRK-020). |
| C6a | "Purpose" definition behind C6 | Position taken in `docs/01` §6: the purpose is letting guests find their photos, and it is treated as expiring at `faceIndexPurgeAt`, at most 730 days after publication. The statutory one-year tail is therefore a margin, not the plan. | Argument only | `docs/01` §6 "Retention" | **[COUNSEL]** Is purpose expiry the purge date, or does it run until the gallery itself stops being served (galleries never expire)? If the latter, the 730-day cap is what keeps the position defensible, and the cap is not enforced below the application layer. |
| C7 | Destroy profile data (`FaceProfile`) | Design: deleted on revoke; purged when unused 3 years. Reality: **no revoke and no purge exist.** Enrolment is disabled by `FACE_PROFILE_ENROLMENT = false`, so the search route ignores `remember` and no profile can be created today. If it were enabled, the route sets `purgeAfter = now() + 3 years` on save; the worker's profile matching never refreshes `lastUsedAt`/`purgeAfter`. | **Not implemented** (and unreachable) | `apps/web/src/lib/faceConsent.ts`; route profile branch; `schema.prisma` `FaceProfile` | WRK-012 (purge), WRK-010 (lifecycle), WEB-006 (revoke), WEB-029 (re-enable enrolment). The three sources disagree on the clock: `docs/01` says "unused for 3 years", the consent text says "3 years after you last saved it", the schema says "lastUsedAt + 3y, refreshed on use". **[COUNSEL]** Is 3 years defensible, or must it be 1 year after last use? Pick one clock before enrolment returns, and version the consent text to match. Also, `_match_profiles` does not check `Guest.faceSearchOptOut`, so an opted-out guest with a profile still gets `PROFILE_AUTO` matches, and an event-scoped delete of their matches is recreated on the next `CLUSTER_FACES` (WRK-020, WRK-010; runbook 2.2). |
| C8 | One-time search data is not kept | Selfie and its embedding are not persisted except through the profile branch (off). | **Implemented in our code**; temp files unverified (worker spool over 1 MB; web tier not inspected) | route; `api.py` | L9 |
| C9 | Ability to show destruction happened | `AuditLog faceindex.purge` (counts of faces, clusters, photos, job id), `Event.faceIndexPurgedAt`, and `scripts/compliance/verify-purge.mjs`, which checks the live database. The admin request row `faceindex.purge.request` records who asked. | **Partial** | handler; admin action; runbook | `AuditLog` is an ordinary table: no immutability, no retention policy yet (ADM-023). The worker's `faceindex.purge` row has no actor. The request row is written when the job is queued, so it does not prove the job ran (L8). A restore can bring purged data back (L6, LEG-008). |
| C10 | Backups | Backups hold embeddings until they expire; a restore re-creates purged data. The destruction timeline is purge date plus the backup tail. | **External** | `docs/ops/backups.md` (DOC-003) | Not described here. Per-person deletions made after a backup cannot be replayed from the database alone: LEG-008. |
| C11 | Per-event off switch | `Event.faceSearchEnabled` gates search (`disabled`), the gallery link and `INDEX_FACES`. Toggle is audited (`event.facesearch.enable/disable`). | **Partial** | route; `index_faces.py`; `cluster_faces.py`; admin settings action | Turning it off leaves existing embeddings in place (G4, WRK-020). `CLUSTER_FACES` selects `faceSearchEnabled` and never uses it, so a disabled event is still clustered, and `_match_profiles` keeps writing `PROFILE_AUTO` matches for any existing profile (none can be created today), including for guests with `faceSearchOptOut` set. |
| C12 | Retention of the consent record itself | `BiometricConsent` rows are kept; no TTL. | Open | schema | Belongs in the retention matrix (LEG-007). **[COUNSEL]** how long consent evidence must be kept. |

## 4. COPPA (guardian searches)

The `docs/01` §6 position: for a child, the personal information "comes from a consenting parent,
not from the child directly". **[COUNSEL]** whether that holds for a selfie of a child taken by the
parent, and whether COPPA applies at all (it covers children under 13; `Guest.isChild` has no age).

| # | Point | Control in the code | Status | Evidence | Gap / ticket |
|---|---|---|---|---|---|
| P1 | Verifiable guardian attestation | The `SEARCH_GUARDIAN` text ("I am this child's parent or legal guardian and agree ...", plus the "Your confirmation" section) must be ticked and is versioned. The row records the adult (`consentedByUserId`) and the child (`subjectGuestId`). The child must be an `isChild` guest in the **viewer's own household**. | **Partial, and not verifiable today** | `legal/consent/v1/search_guardian.*`; `apps/web/src/lib/faceSubject.ts` (`resolveFaceSubject`) | Three things are self-declared or unchecked: the guardian relationship (the host sets `isChild` and household membership); who the consenting adult is, because a forwarded invitation link can consent as the invitee (P7); and whose face is in the "child's selfie" (L12). The household/`isChild` control decides only which child record the results attach to, not whose face is embedded. Whether any of that is "verifiable" for COPPA **[COUNSEL]**. |
| P2 | No child accounts | Children are `Guest` rows, are never invited (`invites/actions.ts` refuses `isChild`), and the guardian flow runs entirely from the adult's session. **Nothing prevents** a child's guest row from being linked to a `User`: the admin form accepts an email or phone for a child, and `linkGuestsForContact` links any matching unlinked guest, child or not. A linked child could then run a `SEARCH_SELF` search; only profile enrolment checks `isChild`. | **Partial** | `packages/shared/src/auth.ts`; `faceConsent.ts` (`mayEnrolFaceProfile`) | G5 (SHR-025). |
| P3 | No face profile for minors | `mayEnrolFaceProfile` rejects guardian searches and `isChild` guests; the page hides the box; enrolment is globally off. | **Implemented** | `apps/web/src/lib/faceConsent.ts` and `faceConsent.test.ts` | |
| P4 | Data minimisation | The child's selfie and embedding are not stored. Results are saved only as `PhotoMatch(subjectGuestId, source=GUARDIAN)`, the `BiometricConsent` row, and the `face.search` audit row, whose `target` is the child's guest id. | **Implemented** | route | The child's face is also in the gallery index like everyone else's (C3, L1). |
| P5 | Delete on guardian request | No self-service. Manual path in the runbook (section 2): set `Guest.faceSearchOptOut`, delete `PhotoMatch` rows for the child, set `BiometricConsent.revokedAt`. `PhotoMatch.subjectGuestId` has **no foreign key**, so deleting a guest does not remove these rows; they must be deleted explicitly. | **Partial** (manual) | schema; runbook | LEG-007 (DSAR flow), WEB-021. |
| P6 | Age scope | `isChild` is a host-set boolean. A 15-year-old marked as an adult searches as an adult. CUBI has no age carve-out. | Open | `guests/actions.ts` | **[COUNSEL]** policy for 13-17. |
| P7 | The consenting adult is who the record says | `face.search` is **not** in the `ELEVATED` set in `packages/shared/src/policy.ts`, so an `INVITE_LINK` session can run `SEARCH_SELF` and `SEARCH_GUARDIAN` searches. The consent row names the user the link was minted for. A forwarded link lets someone else tick the box and search as that person, or on behalf of a child in that person's household. Every other biometric-adjacent action (event settings, uploads, hiding photos) refuses link sessions. | **Not implemented** | `policy.ts` (`ELEVATED`, `case "face.search"`); `createSession(..., "INVITE_LINK")` | G14, SHR-026. |
| P8 | Parental review and notice | The consent text names what is kept; there is no way for a parent to see what is stored about the child. | **Not implemented** | `legal/consent/v1/search_guardian.*` (the text); no code path exists to show the data | LEG-007. |

## 5. Known limitations, stated plainly

These are not hypothetical. Counsel should read them before the consent text.

- **L1. People who never searched are indexed.** When face search is on for an event, every face in
  every READY photo gets an embedding, including children, bystanders and guests who declined to
  take part. Their only protection is host-side notice, and the notice is incomplete (C3).
- **L2. The opt-out the invitation promises does not exist.** The invitation email says guests "can
  opt out from the gallery at any time". Nothing in the product sets `FaceCluster.suppressed` or
  `Guest.faceSearchOptOut` (WEB-021 is unbuilt). The consent texts say self-service is not available;
  the invitation says the opposite. One of them must change before launch.
- **L3. "Remove me" is best-effort even once built.** `FaceCluster.suppressed` removes a cluster from
  matching. Clustering (average linkage, cosine distance 0.637) can split one person across several
  clusters or merge two people, so suppressing "their" cluster may miss some of their faces or hide a
  stranger's. Re-clustering (`_reconcile_clusters`) treats the flag in two different ways: a cluster
  that keeps an old id (the old id most common among its members, plurality) keeps that cluster's
  `suppressed` value whatever share of its members came from it, while a brand-new cluster row is
  suppressed only if a strict majority of all its members were in suppressed clusters. Faces below
  `FACE_MIN_QUALITY` (and unclustered noise) get no cluster at all, so they can never be suppressed
  and stay matchable. Today `faceSearchOptOut` only stops that guest from searching; it does not
  remove their face from the index.
- **L4. "Remove me" cannot remove the person from other people's photos.** The photos stay in the
  gallery; the person can still be seen in them and in `PhotoMatch` lists others have saved. Only
  face-based discovery stops.
- **L5. Matching is probabilistic.** At threshold 0.363 a search can return someone else's photo (a
  lookalike or relative) and miss true ones. Results are limited to photos the viewer may already see.
- **L6. Purging does not reach backups, and a restore reverses it.** See C10.
- **L7. `PhotoMatch` survives the purge and has no expiry.** It is not biometric by design, but it
  records that a named account or child appears in specific photos. The retention decision belongs in
  LEG-007; **[COUNSEL]** whether it should expire with the index.
- **L8. Audit evidence is soft.** `faceindex.purge` is written by the worker in the same transaction
  as the deletes, which is good, but `AuditLog` is mutable and unbounded, the worker row has no
  actor, and `faceindex.purge.request` shows only that a purge was asked for. Always run
  `verify-purge.mjs` as well as reading the audit rows.
- **L9. Selfie handling is not "memory only".** The worker spools uploads over 1 MB to disk
  temporarily. The web tier's handling of the 12 MB upload (Next.js `formData`) has not been
  inspected for temporary files.
- **L10. Nothing purges automatically (G1).** Until WRK-012 ships, retention is a date in a column.
- **L11. A purge is not final.** `PROCESS_PHOTO` enqueues `INDEX_FACES` for every photo it finishes,
  and `INDEX_FACES` ignores `Event.faceIndexPurgedAt`. A photo uploaded or reprocessed after a purge
  is embedded again, and the event keeps its old (past) purge date (G4). The purge also races with
  work in flight: an `INDEX_FACES` that is RUNNING when the purge commits writes its faces back
  afterwards, and queued `faces:*` jobs survive the purge. The admin "Re-index faces" button only
  enqueues `CLUSTER_FACES`, which has nothing to cluster after a purge, so there is currently no
  admin action that rebuilds an index for existing photos either.
- **L12. Nothing checks that the selfie shows the searcher.** The worker returns the largest face
  in whatever image is uploaded. Any guest who can search can upload a photo of another adult, or of
  any child, and find them in the gallery. For adults this makes "a face search for myself" untrue
  and means the person never consented; for children it sidesteps the household and `isChild`
  checks, which only choose the record the results attach to (P1). Preventing it needs liveness or
  identity verification, which is a product and counsel decision (G15, WEB-041). A forwarded
  invitation link adds a second route to the same outcome (P7).
- **L13. All of this runs against drafts.** No consent text has been reviewed by counsel, and the
  Telugu and Hindi texts are machine-drafted and unreviewed by native speakers.

## 6. Gap register

| ID | Gap | Ticket | Status of ticket |
|---|---|---|---|
| G1 | No scheduler runs `PURGE_FACE_INDEX` at `faceIndexPurgeAt`; no profile purge | WRK-012 | existing |
| G2 | Consent row written after capture and only on success | WEB-040 | new, in this PR |
| G3 | Event face index has no purge date until the gallery is published | WRK-021 | new, in this PR |
| G4 | `INDEX_FACES` rebuilds an index after a purge (including a race with in-flight jobs); disabling face search keeps the index and `CLUSTER_FACES` ignores the switch | WRK-020 | new, in this PR |
| G5 | Child guests can be linked to accounts and can self-search | SHR-025 | new, in this PR |
| G6 | Encryption at rest and in transit unverified; worker API unauthenticated | DOC-020 (verify and document); INF-018 (network topology) | new / existing |
| G7 | No "remove me from face search" control; invitation promises one | WEB-021 | existing |
| G8 | No privacy policy, processor list or host agreement | LEG-003, LEG-002 | existing |
| G9 | Profile lifecycle: revoke, `lastUsedAt` refresh, 3-year purge, re-enable enrolment | WEB-006, WRK-010, WEB-029 | existing |
| G10 | Row-level security | DB-004 | existing |
| G11 | Audit log retention and export | ADM-023 | existing |
| G12 | Deletion record that survives a restore | LEG-008 | existing |
| G13 | DSAR flow, `PhotoMatch` retention | LEG-007 | existing |
| G14 | Invitation-link sessions can run face searches and consent as the invitee | SHR-026 | new, in this PR |
| G15 | Nothing checks the selfie shows the searcher | WEB-041 | new, in this PR |

**[COUNSEL] questions for LEG-006**, in one place: (1) is indexing non-searchers' faces "capture" needing
consent, and is notice plus host agreement enough (C3); (2) is purpose expiry the purge date or the
end of gallery availability (C6a); (3) 3 years versus 1 year after last use for profiles (C7);
(4) whether "never saved" survives the temp-file spool (section 2); (5) COPPA applicability to a
parent-supplied selfie, verifiability of the attestation, and the 13-17 policy (P1, P6); (6) how long
consent records and `PhotoMatch` rows may or must be kept (C12, L7); (7) whether a consent is valid
when the person searching uploads someone else's face, and where responsibility sits for that and for
a forwarded invitation link (L12, P7); (8) the statutory exceptions, which this file does not interpret.

## 7. Keeping this file true

- Change a control, change the row and its evidence pointer in the same PR. Rows cite function and
  table names, not line numbers, so they survive edits.
- A new consent version (`legal/consent/v<N>/`) means re-checking section 2.
- When a gap ticket in section 6 closes, move its row to Implemented and delete the matching limitation.
- The deletion procedure and its verification are in
  [runbook-biometric-deletion.md](runbook-biometric-deletion.md).
