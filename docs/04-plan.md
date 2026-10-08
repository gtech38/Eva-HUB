# 04 — Pre-development plan

## 1. Phases

### Phase 0 — Foundations

These pieces are needed before any feature work:

- **Monorepo and local stack.** pnpm, Turborepo, `apps/web`, `workers/media`, `packages/*`. `docker compose` runs Postgres + pgvector, MinIO, Mailpit and the worker.
- **CI.** Typecheck, lint, unit tests, Prisma migrate against a throwaway database, and Python tests. GitHub Actions is fine; the workflow only runs containers.
- **Prisma schema v1.** The subset of the draft needed for Phase 1, plus the tenant-scoped client extension.
- **Auth.** Better Auth with email magic link and email OTP, the session model, the `INVITE_LINK` session scope, and the re-authentication gate.
- **Hostname middleware.** `Domain` lookup, `app.` versus event subdomains, and a wildcard `*.localhost` for development.
- **Job queue.** The `Job` table, a Node enqueue helper, a Python consumer with retry and backoff, and a jobs page in admin.
- **Storage adapter.** Presigned multipart upload and presigned GET, tested against both MinIO and R2.
- **Policy function.** `can()` with a unit test that checks every cell of the permission matrix.

### Phase 1 — MVP

The scope you picked: gallery with face search, event page, guest list and RSVP.

**Event site**

- **All six themes**: Luxury, High-Class Romantic, Elegant Hindu Traditional, Nursery Sage, Telugu Traditional, Midnight Gala (docs/05). Build the shared headless page components first, then the three theme shells on top of them. Expect themes to be the largest front-end item in Phase 1, and get design comps for each before building.
- Fixed pages: Home, About, Schedule (sub-events), Travel, FAQ, Gallery, RSVP.
- "Photography by {Studio}" credit in every theme's footer.
- i18n plumbing with English content. Telugu and Hindi catalogs can land in Phase 2 without schema changes.

**Guests and RSVP**

- Households, guests, kids and plus-one slots.
- Per-guest sub-event invites, with a bulk household editor.
- CSV import with column mapping and a dry-run preview.
- Email invitations with personal magic links to every adult who has an email, plus "resend" (rotates the token). SMS copies of the invitation follow in Phase 2, after 10DLC approval.
- Private-site gate: a themed sign-in screen, OTP sign-in that doesn't reveal who's on the guest list, `noindex`.
- RSVP flow: the household responder answers per member and per sub-event, with meal choice where the sub-event serves a meal.
- Host dashboard: response status, headcount per sub-event, meal counts, CSV export.

**Gallery**

- Studio uploader: drag a folder in, resumable multipart upload, progress bar, deduplication by checksum.
- Worker: derivatives (thumb, web, watermarked web), EXIF capture time and ordering.
- Albums, hiding albums and photos, host-only albums.
- Gallery viewer: masonry grid, lightbox, keyboard and swipe navigation, mobile-first.
- Favorites.
- Full-resolution single download and zip export, behind the entitlement check from the start:
  - **Locked:** viewers see the watermarked web image.
  - **Unlocked:** viewers see the clean image and can download.

  In Phase 1 the studio unlocks a gallery by hand (a comped `GALLERY_FULLRES` entitlement). Stripe checkout for the host package arrives in Phase 2 without changing the gallery code.
- Gallery access for invited guests only, including `galleryOnly` guests.

**Face search**

- YuNet + SFace pipeline with clustering.
- Consent screen and selfie capture from camera or upload.
- "My photos" page backed by `PhotoMatch`.
- Guardian search for child guests in the adult's own household, with guardian consent and a "Family photos" tab.
- "Remove me from face search" control.
- Studio switch to turn face search off per event.
- Retention timestamp set at publish. The purge job itself can ship in Phase 2, as long as it runs before the first window ends.

**Studio admin**

- Create an event, choose the template and slug, assign hosts (invited by email).
- Contacts directory for re-using existing users.

**Done when:** one real event runs end to end. You create it, the host imports guests, email invitations go out, guests RSVP, you upload 1,000+ photos, guests find themselves by selfie, and the zip download works.

### Phase 2 — Commerce, messaging, polish

- **Payments:**
  - Stripe Connect onboarding for the studio.
  - Price sheets.
  - `GALLERY_UNLOCK` checkout for hosts, which replaces the studio's manual unlock.
  - Single-photo digital purchase stays modelled but off by default, since the host's package covers downloads.
- **Print store:** lab adapter (WHCC or another lab, decision pending), crop UI, shipping, fulfilment webhooks.
- **SMS:** invitations, plus reminders at the deadline the host sets (`ReminderRule`). Includes STOP and HELP handling, and requires 10DLC approval first (see long-lead items).
- **Google Contacts import:** People API, with an OAuth app that has passed verification.
- **Registry:** external links, "mark as purchased" claims, and a cash fund (Stripe Checkout or an external handle).
- **Proofing lists** with selection limits and a "submit to studio" lock.
- **Languages:** Telugu and Hindi UI catalogs and content editing.
- **"Remember my face" profiles:**
  - Opt-in at search time.
  - Automatic matching when a new gallery is indexed, with a "we found N photos of you" notice.
  - Revoke from account settings.
  - The 3-year purge job, and stale-profile handling after a model change.

  This lands alongside "My events", since it only pays off at someone's second event.
- **Account management:** the duplicate-user merge flow, and the "My events" dashboard across events.
- **Face index:** the `PURGE_FACE_INDEX` job and retention reporting.

### Phase 3 — SaaS readiness

- Self-serve studio signup, studio subscription billing (Stripe Billing), plan limits and usage metering (storage GB, photos, SMS sends).
- Custom root domains per studio, with on-demand TLS and the cross-domain session handshake.
- Postgres row-level security policies on every tenant table, plus a penetration test focused on tenant isolation.
- Per-studio branding of transactional emails, and studio-defined watermark and theme defaults.
- Platform admin console: studios, usage, support impersonation with audit.
- Optional GPU worker pool and a commercial-licence upgrade of the face model.

## 2. Long-lead items (start now, in parallel)

| Item | Why it's slow | Needed by |
|---|---|---|
| **Studio name and domain**, wildcard DNS | Everything references `yourstudio.com` | Phase 0 |
| **Texas attorney review** of the biometric consent text, host agreement, privacy policy and terms | Legal turnaround | Before the Phase 1 launch |
| **Face model licence decision** (SFace now, or commercial InsightFace) | Vendor negotiation if commercial | Phase 1 build |
| **Twilio (or Telnyx) A2P 10DLC brand and campaign registration** | Vetting takes days to weeks, and can be rejected for vague use cases | Phase 2 SMS |
| **Stripe account and Connect platform profile** | Business verification | Phase 2 |
| **Print lab account** (WHCC requires a pro account and API access approval) | Approval | Phase 2 |
| **Google OAuth app verification** for the contacts scope (a sensitive scope) | Google review, plus privacy policy and demo video | Phase 2 |
| **Email domain authentication** (SPF, DKIM, DMARC) on the sending domain | DNS propagation, and reputation warm-up | Phase 1 |

## 3. Decisions log and remaining questions

### Resolved (2026-10-07)

| Question | Decision |
|---|---|
| Payment model | The host's package unlocks the full gallery. Everyone sees watermarked images until then. Guests can always buy prints. |
| "Remember my face" | Allowed as an opt-in, for adults only. Embedding only, never the image. Revocable, with a 3-year purge when unused. |
| Gallery access | Invited guests only. No PIN or share links. A `galleryOnly` guest flag covers photo-only viewers. |
| Searching for kids | Allowed for adults in the child's household, under guardian consent, with no stored profile. |
| Studio branding | A "Photography by {Studio}" credit in the event site footer |
| First template | All six ship in Phase 1 (three wedding + baby shower, Telugu ceremony, gala) |
| Studio domain | `yourstudio.com` stays a placeholder behind the `ROOT_DOMAIN` config value |

| Face index retention | Set by admins only: a studio default of 365 days, with a per-event override. Always finite (30–730 days). Hosts can't change it. |
| Invitation recipients | Every adult guest with a contact, on every channel they have (email and SMS) |
| Public pages | None. The whole site is behind a magic link or sign-in code, and signed-out visitors see a sign-in screen. |
| Legal pages (resolved 2026-10-08) | The one exception: `/legal/privacy` and `/legal/terms` on the root domain are served without a session, because Stripe, Google OAuth verification and 10DLC each need a public privacy-policy URL. Nothing else is public; event subdomains stay fully gated. See LEG-003. |

### Still open

1. **The real studio domain.** It's needed before Phase 1 launch, for DNS, TLS and email authentication. Everything references `ROOT_DOMAIN` until then.

## 4. Top risks

| Risk | Impact | Mitigation |
|---|---|---|
| Biometric compliance (CUBI and COPPA) for faces of people who aren't searchers, stored face profiles, and guardian searches for minors | Legal or financial | Notice everywhere, host agreement, a removal control, retention purge, per-event switch to turn it off, legal review |
| Face model licensing | Must re-index, or legal exposure | Start with Apache/MIT models, and version embeddings by model |
| Egress cost from 30 GB+ zips and full-resolution views | Hosting bill | R2 (zero egress), CDN for derivatives, cached zips |
| Tenant data leaks in SaaS mode | Trust-ending | Scoped client extension now, row-level security plus a penetration test before outside studios join |
| SMS deliverability and cost (UCS-2 Indic scripts, 10DLC) | Missed RSVPs | Short SMS bodies that link to localized pages, email fallback, early registration |
| Forwarded invitation links | Wrong person RSVPs | Guest-only scope, "Not you?" prompt, RSVP audit trail, token rotation |
| Rendering Indic scripts in luxury display fonts | Broken-looking sites | Pair each theme's display font with a Noto font, and include Telugu and Hindi in the visual regression tests |

## 5. Suggested first steps once the open questions are settled

1. Initialise the repo and the docker-compose stack (Phase 0).
2. Trim `schema.draft.prisma` down to the Phase 1 tables, then run the first migration.
3. Spike the face pipeline on a real 1,000-photo wedding set: precision and recall of YuNet + SFace with clustering, and throughput per vCPU. This decides whether SFace is good enough before the UI is built on top of it.
4. Build the hostname middleware and the first theme's Home and RSVP pages with seed data.
