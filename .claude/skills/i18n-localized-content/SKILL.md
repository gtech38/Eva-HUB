---
name: i18n-localized-content
description: Use when adding or rendering any user-visible text or host-authored content: packages/shared/src/i18n.ts (t, ui, UI, LOCALES), pages.ts Zod page schemas and parsePage, the hub_lang cookie and ?lang= switch, admin LocalizedInputs/PageEditor, adding a UI string, checking Telugu/Hindi rendering, and SMS UCS-2 segment counts (sms.ts smsSegments).
---

# i18n and localized content

## When this applies
- New label, button, error or notice on the guest site.
- New field in an `EventPage` content type or a new page type.
- Anything that reads `Event.title`, `SubEvent.name`, `Album.title`, `MealOption.label` or `EventPage.content`.
- Composing SMS bodies.

## Where things live

| Path | What |
|---|---|
| `packages/shared/src/i18n.ts` | `LOCALES = ["en","te","hi"]`, `Locale`, `LocalizedText = Partial<Record<Locale,string>>`, `t(text, locale, fallback="en")`, `isLocale()`, `LOCALE_NAMES`, `UI` catalog object, `ui(key, locale)` |
| `packages/shared/src/pages.ts` | `Localized` Zod record, one schema per `PageType` (`HomeContent`, `AboutContent`, `ScheduleContent`, `TravelContent`, `FaqContent`, `WeddingPartyContent`, `RegistryContent`, `GalleryContent`, `RsvpContent`), `PAGE_SCHEMAS`, `parsePage()`, `PAGE_PATHS` |
| `packages/shared/src/sms.ts` | `smsSegments(body)` GSM-7 vs UCS-2 |
| `apps/web/src/middleware.ts` | `?lang=xx` -> sets `hub_lang` cookie (1 year, `sameSite: lax`) and redirects to the clean URL |
| `apps/web/src/lib/site.ts` | picks `locale`: cookie if `isLocale` and in `event.enabledLocales`, else `event.defaultLocale`, else `en` |
| `apps/web/src/lib/gallery-strings.ts` | Page-local string table pattern (`S = {...} satisfies Record<string, LocalizedText>` + `galleryStrings(locale)`) |
| `apps/web/src/app/sites/[slug]/gallery/me/page.tsx` | Same pattern for face-search copy (consent text, errors) |
| `apps/web/src/lib/format.ts` | `Intl` date/time formatting with `en-US`/`te-IN`/`hi-IN` |
| `apps/web/src/components/chrome.tsx` `LangSwitcher` | renders `?lang=` links when >= 2 locales enabled |
| `apps/admin/src/components/ui.tsx` `LocalizedInputs` | three inputs named `${name}.en|te|hi` |
| `apps/admin/src/lib/action.ts` `localized(fd, key)` | reads those three fields into `{ en?, te?, hi? }` |
| `apps/admin/src/app/studios/[studioId]/events/[eventId]/pages/PageEditor.tsx` + `actions.ts` `savePage` | generic editor driven by the Zod shape: `ZodRecord` -> localized inputs, `ZodArray` -> JSON textarea, else string |
| `apps/admin/src/lib/format.ts` `lt(x, locale="en")` | admin-side `t()` that tolerates unknown input |

## Conventions in this repo
- **Two kinds of text.** Host content is `LocalizedText` JSON in the DB and rendered with `t(value as object, locale)`. UI chrome is code: the small `UI` object for cross-page labels, plus per-page `S` tables (`gallery-strings.ts`) for larger sets. There is no `next-intl` and no message files (docs/01 §4 planned them; `i18n.ts` says "move to next-intl when the catalogs grow").
- **Fallback order** in `t()`: requested locale -> `fallback` arg (default `en`) -> `en` -> first non-empty value -> `""`. Pass the event's `defaultLocale` as `fallback` when it matters.
- **Every string table is `satisfies Record<string, LocalizedText>`** so a missing `en` is a type error only if you omit the key entirely; convention is to always provide `en`, and `te`/`hi` wherever the string is guest-facing.
- **Strings are resolved on the server** and passed to client components as plain `string` props (`GalleryStrings`, `FaceStrings`). Client components never call `t()` with locale themselves.
- **`<html lang>` is `en`; the theme wrapper sets `lang={locale}`** (`sites/[slug]/layout.tsx`), which matters for font fallback and screen readers.
- **Zod page schemas default every field** (`Localized.default({})`, arrays `.default([])`) so `parsePage(type, null)` always returns a complete object; pages render safely before a host edits anything.
- **Admin edits content in all three languages at once** via `LocalizedInputs`; English is required for titles (`EventSettings.title.en min(1)`).
- No emojis in UI copy.

## Common tasks

### Add a UI string
1. Test first: `packages/shared/src/i18n.test.ts` (node:test): `assert.equal(ui("registryClaim", "te"), "...")` and a fallback case `t({ en: "x" }, "hi") === "x"`. Runs with `pnpm --filter @hub/shared test` (the glob is `src/*.test.ts`).
2. Add the key to `UI` in `i18n.ts` with `en`, `te`, `hi`. If it is page-local, add it to that page's `S` table instead (keeps `UI` small).
3. Use `ui("registryClaim", locale)` on the server; pass the result down as a prop.

### Add a field to a page type (e.g. `dressCodeNote` on `ScheduleContent`)
1. Test first: `packages/shared/src/pages.test.ts`: `parsePage("SCHEDULE", {}).dressCodeNote` deep-equals `{}`; `parsePage("SCHEDULE", { dressCodeNote: { te: "..." } })` round-trips.
2. Add `dressCodeNote: Localized.default({})` to `ScheduleContent`. `savePage` in admin picks it up automatically (it iterates the schema shape), and `PageEditor` renders `LocalizedInputs` for any `ZodRecord`.
3. Render in `apps/web/src/app/sites/[slug]/schedule/page.tsx` with `t(content.dressCodeNote, locale)`.
4. Seed (optional) in `packages/db/prisma/seed.ts` pages array.

### Add a page type
Add to `enum PageType` in `schema.prisma` (migration), to `PAGE_SCHEMAS` and `PAGE_PATHS` in `pages.ts`, to `PAGE_ORDER` in `apps/admin/src/lib/data.ts`, to `NAV_LABEL`/`order` in `sites/[slug]/layout.tsx`, and create the route folder. Test: `pages.test.ts` asserting `Object.keys(PAGE_SCHEMAS)` equals `Object.keys(PAGE_PATHS)`.

### Render a date
Never format dates by hand; use `fmtDate/fmtTime/fmtDateTime/fmtDayLabel(d, event.timezone, locale)` from `apps/web/src/lib/format.ts`. Timezone is `Event.timezone` (default `America/Chicago`).

### Check Telugu/Hindi rendering
```bash
open 'http://priya-arjun.localhost:3000/?lang=te'; open 'http://priya-arjun.localhost:3000/?lang=hi'
```
Look at: nav labels wrapping, hero headline line-height, RSVP radio labels, gallery empty state, sign-in gate help text (incognito). Telugu runs longer and taller than English; Hindi uses the serif Devanagari pairing in the Hindu theme. See `tailwind-themes` for the font stack.

### Count SMS segments
```ts
import { smsSegments } from "@hub/shared/sms";
smsSegments("Priya & Arjun: you're invited! ...") // GSM-7: 160 then 153/segment
smsSegments("ప్రియ & అర్జున్: ...")                // UCS-2: 70 then 67/segment
```
Any non-GSM character (Telugu, Devanagari, curly quotes, em dash) flips the whole body to UCS-2. Keep SMS bodies to a title + link and send the localized page instead of localized SMS (docs/01 §7). Test: `packages/shared/src/sms.test.ts` with a 71-char Telugu body expecting 2.

## Gotchas
- `t()` accepts `string | LocalizedText | null`; Prisma `Json` fields are typed `JsonValue`, so call sites cast: `t(event.title as object, locale)`.
- `?lang=` is handled by middleware only on non-API, non-static paths; `/api/*` never changes the cookie.
- The cookie is set even for locales the event has not enabled; `getSite()` then ignores it. `LangSwitcher` only offers enabled locales.
- `enabledLocales` must contain `defaultLocale` -- `updateEventSettings` enforces it; the seed sets `["en","te","hi"]` only for `priya-arjun`.
- `savePage` stores `{}` for empty localized fields and strips empty strings; `t({}, "te")` returns `""`, so guard empty headings in templates.
- `smsSegments` is a heuristic (counts UTF-16 code units via `body.length`); surrogate pairs (emoji) count double, which matches UCS-2 cost.
- Admin `lt()` defaults to English regardless of the admin user's locale; admin is English-only by design.

## Verification
```bash
pnpm --filter @hub/shared test
pnpm typecheck
curl -s -H 'Host: priya-arjun.localhost' -c - 'http://localhost:3000/?lang=te' | grep hub_lang
curl -s -H 'Host: priya-arjun.localhost' -b 'hub_lang=te' http://localhost:3000/ | grep -c 'lang="te"'
```

## References
- `docs/01-architecture.md` §4 i18n (mentions `next-intl` catalogs -- not implemented) and §7 UCS-2 note
- `docs/03-data-model.md` §2.7 LocalizedText rationale
- GSM 03.38 character set: https://en.wikipedia.org/wiki/GSM_03.38
- `Intl.DateTimeFormat`: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
- Related skills: `tailwind-themes`, `guest-site-patterns`, `email-sms-adapters`
