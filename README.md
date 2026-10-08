# Event & Photo Delivery Hub

A multi-tenant platform for event websites (invitations, RSVPs, schedule, registry, content pages) and photo delivery (galleries, face search, downloads, print sales). It is built for one studio first, with a data model ready to become a SaaS product for other photographers.

## Running locally

Everything runs on this machine; nothing is deployed. See [CLAUDE.md](CLAUDE.md) for the full command list.

```bash
cp .env.example .env
pnpm install
pnpm infra:up                         # Postgres+pgvector :5433, S3 (RustFS) :9000, Mailpit :8025
pnpm db:migrate && pnpm db:seed          # on an existing dev DB use `pnpm db:reset` first: the seed only adds, never rewrites
pnpm dev                              # event sites on :3000, admin on :3001
cd workers/media && make models && make dev
```

| URL | What |
|---|---|
| http://priya-arjun.localhost:3000 | Hindu Traditional wedding |
| http://sofia-james.localhost:3000 · http://emma-liam.localhost:3000 | Luxury · Romantic weddings |
| http://baby-reddy.localhost:3000 | Nursery Sage baby shower |
| http://reddy-gruhapravesam.localhost:3000 | Telugu Traditional gruhapravesam (en/te/hi) |
| http://ravi-50.localhost:3000 | Midnight Gala 50th birthday |
| http://localhost:3001 | Admin — sign in as `admin@localhost` |
| http://localhost:8025 | Mailpit — magic links and invitations land here |
| http://localhost:9001 | S3 console (minio / minio12345) |

## Planning documents

| Doc | What it covers |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | System components, tenancy and routing, storage, the face pipeline, provider-agnostic deployment |
| [docs/02-users-and-roles.md](docs/02-users-and-roles.md) | Identity model, magic links, account resolution across events, role and permission matrix |
| [docs/03-data-model.md](docs/03-data-model.md) | Entity overview, ERD, key modelling decisions |
| [docs/schema.draft.prisma](docs/schema.draft.prisma) | Draft Prisma schema (not yet migrated) |
| [docs/04-plan.md](docs/04-plan.md) | Phased delivery, MVP scope, long-lead items, open questions, risks |
| [docs/adr/README.md](docs/adr/README.md) | Architecture decision records: what we chose and why (queue, storage, tenancy, face model, auth) |

## Decisions so far (2026-10-07)

| Area | Decision |
|---|---|
| Tenancy | One platform and one database. Hierarchy is **Studio → Event**. Every tenant row is scoped. |
| Domains | `{event-slug}.yourstudio.com` (wildcard subdomain). Admin at `app.yourstudio.com`. `yourstudio.com` is a placeholder until the real domain is chosen; keep it in one config value (`ROOT_DOMAIN`). |
| Templates | Six themes: **Luxury**, **High-Class Romantic**, **Elegant Hindu Traditional** (weddings) and **Nursery Sage** (baby showers), **Telugu Traditional** (ceremonies), **Midnight Gala** (parties). Each reads `Event.kind` for its wording. See [docs/05-theme-references.md](docs/05-theme-references.md). |
| Branding | The event site footer shows a "Photography by {Studio}" credit. Sites are not white-labelled. |
| Hosting | Provider-agnostic: Docker containers, Postgres + pgvector, S3-compatible storage, CDN |
| Stack | Next.js (TypeScript, App Router), Prisma, Postgres, Python worker for media and faces, S3/R2 |
| Payments | Stripe, through the platform. Stripe Connect from day one so the SaaS path stays open. |
| Payment model | The host's package unlocks the full gallery. Everyone sees watermarked images until then. Guests can always buy prints. |
| Site access | **The whole site** (pages, RSVP, gallery) is for invited guests only, via magic link or sign-in code. No public pages, and no PIN or share links. |
| Roles | Super-admin, studio staff, host, co-host/planner, guest, vendor |
| Guest access | Every invite is a personal magic link. Clicking it creates or resolves one global user account. |
| Accounts | One user account across all events. Linking happens only through a **verified** email or phone. |
| Guests | Households with named members, kids and plus-ones. Invitations and RSVPs per sub-event. Meal choice. |
| Messaging | Email and SMS invites to every adult with a contact, on every channel they have. SMS reminders when no response arrives by a deadline the host sets. |
| Import | CSV and Google Contacts |
| Registry | External links, a cash/honeymoon fund (Stripe or Venmo link), and "mark as purchased" |
| Photos | Studio uploads only, 100 to 2,000 per event. Albums and photo-level hiding. Favorites and proofing. Full-res downloads and zip. Watermarks before payment. No expiry. Print store. |
| Face search | Self-hosted embeddings in pgvector. Opt-in. The selfie image is never stored. The face index is purged after a retention window set by admins (30–730 days, default 365). Texas (CUBI). |
| Remember my face | Opt-in face profile reused across events, which auto-matches new galleries. Adults only. |
| Kids | A parent or guardian in the same household can search for a child with the child's selfie, under guardian consent. |
| Content | Fixed page types. Multilingual (English, Telugu, Hindi). |
| Devices | Responsive web for desktop, tablet and mobile |
| MVP | Gallery with face search, event page, guest list and RSVP |
