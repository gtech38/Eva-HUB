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
| `src/middleware.ts` | Host -> `/sites/{slug}`; `?lang=` cookie; forwards `x-hub-slug`, `x-hub-path` |
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
- **Content pages** read `parsePage(TYPE, page(site, TYPE)?.content)`; nav shows HOME/SCHEDULE/RSVP/GALLERY always, other types only when an enabled `EventPage` exists.
- **Server actions over routes** except downloads/face search. Actions return small objects (`{ ok, favorited }`) or `redirect()`.
- **Every response is `private, no-store` + `noindex`** (next.config headers, root metadata, robots route). Never add caching.
- **Audit guest-side writes**: `rsvp.respond`, `face.search`, `photo.download`, `auth.*`.

## Common tasks

### Add a guest page end-to-end (Registry)
1. Test first: `src/lib/registry.test.ts` (vitest) for a pure helper, e.g. `remainingQuantity(item, claims)` and `sortRegistry(items)`; plus `packages/shared/src/pages.test.ts` if `RegistryContent` gains fields. Run with `pnpm --filter @hub/web test`.
2. Data: `RegistryItem`, `RegistryClaim`, `CashFund` already exist; admin editor exists under `events/[eventId]/registry`. Add `lib/registry.ts` with the pure helpers and a loader `loadRegistry(eventId)`.
3. Page `src/app/sites/[slug]/registry/page.tsx`: standard prologue; `const intro = t(parsePage("REGISTRY", page(site, "REGISTRY")?.content).intro, locale)`; list items (external links `rel="noopener noreferrer"`), cash funds (`EXTERNAL` shows the handle; `STRIPE` shows a placeholder until payments land).
4. Action `registry/actions.ts`: `claimItem(itemId, qty)` -> `requireViewer()`, require `viewer.can("site.view")` (and add a `registry.claim` Action to `can()` per `auth-sessions-policy`), verify `item.eventId === event.id`, create `RegistryClaim { userId }`, audit `registry.claim`, `revalidatePath("/registry")`.
5. Nav: `REGISTRY` already maps to `/registry` and `ui("registry")`; it appears when the admin enables the page.
6. Strings: a local `S` table with en/te/hi for "Mark as purchased", "Purchased", "Fund" etc.
7. Verify: `curl -s -b "hub_session=$C" -H 'Host: priya-arjun.localhost' http://localhost:3000/registry | grep -c 'Registry'`, then the three locales.

### Add a gallery capability (e.g. zip download link)
Gate with `viewer.can("gallery.view")` and an entitlement check (`GALLERY_ZIP` or `GALLERY_FULLRES`); create `ZipExport` and `enqueue("BUILD_ZIP", { zipExportId }, { dedupeKey: \`zip:${eventId}:${scopeHash}\` })`; the worker already builds parts (`build_zip.py`). Serve part URLs via `storage.presignDownload`. Test the `scopeHash` helper first.

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
