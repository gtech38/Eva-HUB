---
name: guest-site-patterns
description: Use when building or changing the guest-facing event sites in apps/web (:3000, {slug}.localhost): getSite()/requireViewer() in lib/site.ts, the sign-in gate in sites/[slug]/layout.tsx, lib/gallery.ts visibility and entitlement helpers, server actions for RSVP and favorites, API routes for download and face search, themed components in components/, locale handling, and adding a guest page (e.g. Registry) end-to-end with a test.
---

# Guest site patterns (apps/web)

## When this applies
- New or changed page under `src/app/sites/[slug]/`.
- Anything a guest can see or do: RSVP, gallery, favorites, face search, downloads.
- Visibility bugs (a guest sees a hosts-only album, a hidden photo, another household).

## Where things live

| Path | What |
|---|---|
| `src/middleware.ts` | Host -> `/sites/{slug}`; `?lang=` cookie; forwards `x-hub-slug`, `x-hub-path` and the trusted `x-hub-host` (always overwritten from `Host`) |
| `src/lib/siteMetadata.ts` | `siteMetadata({ title, previewTitle, origin })`: the only metadata an event site has (sign-in title, fixed description, noindex robots, `og:image` = `/og.png`, twitter `summary`); inner pages define none |
| `src/app/sites/[slug]/og.png/route.tsx` + `lib/{ogCard,ogFonts,ogRender,ogResponse}` | link-preview image: monogram + default-locale title on theme colours (see "The one public response") |
| `src/lib/site.ts` | `resolveEvent(hostname)` (Domain table, then slug), `getPrincipal()`, `getSite()` -> `SiteContext { event(+pages), studio, brand, monogram, locale, principal, viewer }`, `requireViewer()`, `page(site, type)`, `siteOrigin()` |
| `src/app/sites/[slug]/layout.tsx` | theme wrapper, nav (`buildNav`), **sign-in gate** when `viewer` is null, "not live yet" screen for non-staff on DRAFT events |
| `src/app/sites/[slug]/page.tsx` | Home: `theme.Hero`, upcoming sub-events for the household, RSVP/Gallery cards |
| `about`, `schedule`, `travel`, `faq` pages | content pages from `parsePage()` |
| `rsvp/{page,actions,data}.ts(x)` | household RSVP: `loadHousehold()`, `submitRsvp` (per guest x sub-event, meal, plus-one names, audit `rsvp.respond`) |
| `gallery/{page,[albumId]/page,me/page,actions}.ts(x)` | albums grid, album photos, My photos (face search), `toggleFavorite` |
| `src/lib/gallery.ts` | `visibleVisibilities(viewer)`, `visiblePhotoWhere(eventId, viewer, extra)`, `listVisibleAlbums`, `isEntitledFullRes`, `toPhotoDTOs` (`PhotoDTO` with `thumbUrl`, `webUrl` clean-or-watermarked, `favorited`, `canDownload`, `score?`) |
| `src/app/api/photos/[id]/download/route.ts`, `src/app/api/face/search/route.ts` | the only browser-URL endpoints |
| `src/app/sites/[slug]/{auth/actions.ts, auth/callback, auth/signout, i/[token]}` | sign-in, magic link, invite link (see `auth-sessions-policy`) |
| `src/components/{SignIn,PageHeader,Countdown,chrome}.tsx`, `components/gallery/{PhotoGrid,FaceSearch}.tsx` | shared headless components; `PageHeader`/`EmptyState` server, the rest client |
| `src/lib/{format,gallery-strings,face,session}.ts` | formatting, string tables, consent version, cookie options |
| `src/app/{root/page,not-found,robots.txt/route,api/health}` | root host landing, 404, `Disallow: /`, health |

## Conventions in this repo
- **Every page starts the same way:** `export const dynamic = "force-dynamic"; const site = await requireViewer(); if (!site) return null;` then destructure `{ event, locale, viewer }`. The layout has already rendered the sign-in gate, so `null` is never visible.
- **`Viewer` is the authority on the page:** `viewer.can(action)`, `viewer.guest` (this user's row + household, or null for staff/hosts without one), `viewer.seesAllSubEvents` (hosts/planners/vendors/studio), `viewer.canHostsOnlyAlbums`, `viewer.isStudio`. Pages hide UI with `viewer.can(...)`; actions re-check.
- **Household scoping for guests:** sub-events shown to a plain guest are those with `invites.some({ guest: { householdId } })`; RSVP writes iterate the server-loaded household, never form-provided ids.
- **Photo visibility is one function:** always build `where` with `visiblePhotoWhere(event.id, viewer, extra)` (status READY, not hidden, album visibility in `visibleVisibilities`). Face results and downloads go through it too.
- **Clean vs watermarked** is decided in `toPhotoDTOs` by `isEntitledFullRes(event.id, userId)`; the download route additionally allows `viewer.isStudio`.
- **Strings:** resolved server-side (`galleryStrings(locale)`, `ui()`, `t()`), passed as props. Dates via `lib/format.ts` with `event.timezone`.
- **Content pages** read `parsePage(TYPE, page(site, TYPE)?.content)`; nav shows HOME/SCHEDULE/RSVP/GALLERY always, other types only when an enabled `EventPage` exists. The nav is built by `buildNavItems` in `lib/nav.ts` (tested; order HOME, ABOUT, SCHEDULE, TRAVEL, WEDDING_PARTY, FAQ, REGISTRY, RSVP, GALLERY). The WEDDING_PARTY label is kind-aware (`hostsPageLabel`: "Wedding Party" via `ui("party")` for weddings, "Hosts"/"Family" otherwise). Add a new page type to `ORDER` there, not in the layout.
- **Server actions over routes** except downloads/face search. Actions return small objects (`{ ok, favorited }`) or `redirect()`.
- **Every response is `private, no-store` + `noindex`** (next.config headers, root metadata, robots route). Never add caching -- with exactly one exception:
- **The one public response: `/og.png`.** It is public (`public, max-age=86400`, ETag/304), visitor-independent and network-free, and it must stay all three: resolve the event only from the trusted `x-hub-host` (never `X-Forwarded-Host`, `getSite()`, the session or cookies), build the card only from `ogCardForEvent(event)` (title in `event.defaultLocale`, `themeOverrides.monogram`, theme colours), render with the committed fonts in `apps/web/assets/og-fonts` through `fitToFonts` + satori with `loadAdditionalAsset: async () => []` (no Google Fonts, no emoji CDN), buffer the PNG before responding (errors are `500 private, no-store`), memoise by `(event.id, event.updatedAt)`. It shows only what the signed-out sign-in screen shows, for every event status. Nothing else on an event host may be public.
- **Audit guest-side writes**: `rsvp.respond`, `registry.claim` / `registry.unclaim`, `face.search`, `photo.download`, `auth.*`.

## Common tasks

### Registry and Wedding Party pages (WEB-009, built; use as the template for a new guest page with writes)
Where: `sites/[slug]/registry/{page,actions}.ts(x)`, `sites/[slug]/party/page.tsx`, `components/registry/{ClaimControls,CopyButton}.tsx`, `lib/{registry,registryClaims,party,nav}.ts` (+ tests).
- **Pure rules in `lib/registry.ts`** (tested without a DB): `remainingQuantity`, `checkClaim` (over-claim refusal), `canUndoClaim` / `UNDO_WINDOW_MS` (own claim, 24 h), `registryItemView` (per-viewer view model; other guests' claims are never sent to the client), `claimGate` (page enabled AND event LIVE), `clampQuantity`, `claimMessageKey`, `safeExternalUrl` (absolute http(s) only, no credentials; `{ httpsOnly: true }` for auto-loaded images).
- **DB rules in `lib/registryClaims.ts`** (Postgres test seeds its own studio and two events and FAILS under `CI` when Postgres is down): `claimRegistryItem` locks the item row (`SELECT ... FOR UPDATE`) so concurrent claims cannot oversell, validates the quantity first (an invalid quantity is never an idempotent success), treats a repeat claim by the same user on the same item for the same quantity within `CLAIM_DEDUPE_WINDOW_MS` (10 s) as a double submit and returns the first claim (a different quantity is a new claim, still subject to what remains), audits `registry.claim` in the same transaction, and turns DB errors into `{ ok: false, reason: "failed" }`; `undoRegistryClaim` is one conditional `deleteMany` (userId + 24 h + eventId) plus `registry.unclaim`.
- **Actions are thin and re-check what the layout hides:** `requireViewer()` -> `viewer.can("registry.claim")` (guest-only, platform admins included) -> `claimGate({ registryEnabled: !!page(site, "REGISTRY"), eventStatus })` for claims (page enabled AND event LIVE) or `undoGate({ eventStatus })` for undo (event LIVE only: a guest can still take back their own claim within 24 h after the host disables the page) -> one lib call -> `revalidatePath("/registry")`. Identity (`userId`, display name) comes from the session, never from the form. Refusals return a localized `message` from `ui(claimMessageKey(reason), locale)`.
- **Page:** `page(site, "REGISTRY")` null (disabled) -> `notFound()`. STRIPE funds render a disabled "Contribute" with "Coming soon" until WEB-025. Strings are `UI` keys in `packages/shared/src/i18n.ts` (en/te/hi, enforced by `i18n.test.ts`), not a local table.
- **Wedding Party (`/party`):** `groupByRole` groups by localized role text (case/whitespace-insensitive). Host-authored `photoKey` is only presigned when `isEventSiteKey(key, studioId, eventId)`, i.e. under `s/{studio}/e/{event}/site/` followed by plain name segments only (an allowlist `[A-Za-z0-9][A-Za-z0-9._-]*` joined by single `/`: no percent-encoding, `//`, trailing `/`, control characters or dot segments, so a CDN that normalises URLs cannot turn a key into traversal); `orig/`, `d/` and `zip/` keys are refused because they would hand every guest an original or a hidden photo, bypassing visibility and `isEntitledFullRes`. Never presign a key taken from page content without that check.
- **Verify:** mint guest sessions (`apps/admin/scripts/smoke-session.mts <email>`), `curl` the page with `-b "hub_session=$C" -H 'Host: priya-arjun.localhost'`, and call the server actions with `-H "Next-Action: <id>"` (ids are in the page's client chunk as `createServerReference("<id>", ..., "claimItem")`), `Origin` equal to the `Host`, body `["<itemId>", 1]`.

### Add a gallery capability (e.g. zip download link)
Gate with `viewer.can("gallery.view")` and an entitlement check (`GALLERY_ZIP` or `GALLERY_FULLRES`); create `ZipExport` with `studioId` and `eventId` (`studioId` is required; the worker derives the storage key and scopes the photo query from the row alone) and `enqueue("BUILD_ZIP", { zipExportId }, { dedupeKey: \`zip:${eventId}:${scopeHash}\` })`; the worker already builds parts (`build_zip.py`). Serve part URLs via `storage.presignDownload`. Test the `scopeHash` helper first.

### Change RSVP behaviour
Edit `rsvp/actions.ts` `submitRsvp` and the form names (`rsvp.{guestId}.{subEventId}`, `meal.{guestId}.{subEventId}`, `name.{guestId}.first|last`). Keep: only invited sub-events are writable, meal only when `servesMeal` and the option belongs to that sub-event, audit with the full summary. Test the parsing step as a pure function first (extract `parseRsvpForm(formData, household)`).

### Add a client component
`"use client"`; props are strings/DTOs; call server actions imported from `app/sites/[slug]/**/actions.ts`; optimistic updates with `useTransition` (see `PhotoGrid.toggle`). No `prisma`, no root `@hub/shared`.

## Gotchas
- `requireViewer()` only checks that a `viewer` exists; the "not live yet" screen for DRAFT events is rendered by the layout, not by `requireViewer()`. Pages are safe because they render inside the layout, but `api/*` routes bypass the layout: they call `requireViewer()` and must check `event.status !== "LIVE"` themselves where it matters (the download and face-search routes currently do not).
- INVITE_LINK sessions scoped to another event get the sign-in gate here even if the user is a guest of both events (`scopedElsewhere`).
- `page(site, "FAQ")` is null when the admin disabled the page; `parsePage` with `undefined` returns defaults, so pages never crash but may render empty; add an `EmptyState`.
- Album pages 404 (not 403) for albums outside `visibleVisibilities` -- keep that; it avoids revealing hosts-only albums.
- Favorites strip on `/gallery` is capped at 24 (`take: 24`).
- `PhotoDTO.webUrl` for an unentitled viewer may still be the clean `web` key if `webWm` is missing (older processing) -- `toPhotoDTOs` falls back; re-process photos rather than special-casing.
- `siteOrigin()` keeps `:3000` only when `ROOT_DOMAIN === "localhost"`; email links use `eventOrigin()` from shared which has the same rule.
- Hero images: `HomeContent.heroKey` is a storage key; there is no uploader yet, so `heroUrl` is null in seed data.

## Verification
```bash
pnpm --filter @hub/web typecheck && pnpm --filter @hub/web build
# gate: signed out -> sign-in form, no nav
curl -s -H 'Host: priya-arjun.localhost' http://localhost:3000/rsvp | grep -c 'name="contact"'
# guest cannot see hosts-only album: find its id in admin, expect 404
curl -s -o /dev/null -w '%{http_code}\n' -b "hub_session=$GUEST" -H 'Host: priya-arjun.localhost' http://localhost:3000/gallery/<hostsOnlyAlbumId>
```

## References
- `docs/01-architecture.md` §4 (private sites, sign-in screen, crawlers), §5 (serving rules)
- `docs/02-users-and-roles.md` §5-6 (site access, effective visibility)
- `docs/04-plan.md` Phase 1 (what the MVP guest site must do)
- Related skills: `nextjs-app-router`, `auth-sessions-policy`, `tailwind-themes`, `i18n-localized-content`, `face-recognition-pipeline`, `payments-stripe-placeholder`
