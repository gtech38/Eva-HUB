---
name: tailwind-themes
description: Use when styling the guest site (apps/web/src/themes/*, tailwind.config.ts, globals.css), adding or changing a theme (ThemeKey enum + THEMES map + admin swatch), working with the Shell/Hero/Divider contract in themes/types.ts, self-hosted fonts in themes/fonts.ts and themes/font-files/ (next/font/local, Noto Telugu/Devanagari fallbacks), or admin app styling (apps/admin globals.css utility classes). Includes how to check a theme visually across ?lang=te|hi.
---

# Tailwind + themes

## When this applies
- Any visual change on an event site or in admin.
- Adding a fourth theme or changing tokens of an existing one.
- Font or Indic-script rendering issues.

## Where things live

| Path | What |
|---|---|
| `apps/web/tailwind.config.ts` | Semantic color classes bound to CSS vars: `bg`, `surface`, `fg`, `muted`, `accent`, `accent-fg`, `line`; fonts `font-display`, `font-body`, `font-script`; `rounded-theme` |
| `apps/web/src/app/globals.css` | `:root` neutral defaults, `body` font stack, shared primitives (`.btn`, `.btn-ghost`, `.input`, `.card`, `.eyebrow`, `.nav-link`, `.prose-site`, `.fade-in`), pure-CSS ornaments per theme — Luxury: `.velvet`, `.gold-frame`, `.hairline`, `.initial-script`; Romantic: `.ivory-sky`, `.petals`/`.petal`; Hindu: `.paper`, `.gold-double-frame`, `.ornament-line`, `.maroon-panel` |
| `apps/web/src/themes/types.ts` | `Theme = { key, name, vars, rootClass?, Shell, Hero, Divider }`, `ShellProps`, `HeroProps`, `NavItem` |
| `apps/web/src/themes/index.ts` | `THEMES: Record<ThemeKey, Theme>`, `themeFor(key)` (falls back to luxury) |
| `apps/web/src/themes/{luxury,romantic,hindu-traditional}/index.tsx` | One file per theme: `vars` + `Shell` + `Hero` + `Divider` |
| `apps/web/src/themes/fonts.ts` | All `next/font/local` declarations (15 self-hosted families); `fontVariableClasses` applied on `<html>` in `app/layout.tsx` |
| `apps/web/src/themes/font-files/` | The vendored WOFF2 files, one directory per family with its `OFL.txt`, plus `README.md` (licences, sizes, subsets) and `build.sh` (reproducible rebuild from google/fonts) |
| `apps/web/src/themes/{fonts,fontFiles}.test.ts` | Contract tests: no `next/font/google` anywhere under `apps/`, every `--font-*` a theme uses is declared, weights/styles table, 1.2 MB budget, licences, glyph coverage |
| `apps/web/src/components/chrome.tsx` | Theme-agnostic `Nav`, `LangSwitcher`, `NotYou`, `Credit` that every Shell lays out |
| `apps/web/src/app/sites/[slug]/layout.tsx` | Applies `style={theme.vars}`, `data-theme`, `lang`, renders `theme.Shell` and the sign-in gate |
| `apps/admin/src/lib/data.ts` `THEMES` | Admin picker labels + swatches; `components/ThemePicker.tsx` |
| `apps/admin/src/app/globals.css` | Admin utility classes (`.btn-primary|secondary|danger|ghost`, `.btn-sm`, `.input`, `.card`, `.table`, `.label`, `.help`, `.error`, `.badge`) |
| `packages/db/prisma/schema.prisma` | `enum ThemeKey { LUXURY ROMANTIC HINDU_TRADITIONAL }` |

## Conventions in this repo
- **Tokens, not colors, in components.** Pages and shared components use `bg-bg`, `text-fg`, `text-muted`, `border-line`, `bg-accent`, `text-accent`, `rounded-theme`, `font-display`, `font-body`. Only a theme's own `index.tsx` may use literal hex (in `vars`) or `style={{ color: "var(--accent-2)" }}` (the Hindu theme does, because `--accent-2` has no Tailwind class).
- **A theme is tokens plus three components.** `vars` sets `--bg --surface --fg --muted --accent --accent-2 --accent-fg --line --radius --font-display --font-body --font-script`. `Shell` renders header/nav/footer around `children`; `Hero` renders the home header; `Divider` is the ornament used on the sign-in gate and between sections. Everything else (PhotoGrid, RSVP form, PageHeader) is shared and themed through tokens.
- **Nav is hidden on the sign-in gate:** Shells render `Nav`/`NotYou` only when `viewerName !== null`.
- **Footer credit is mandatory:** every Shell renders `<Credit brand={brand} locale={locale} />` ("Photography by {Studio}", from `Studio.brandJson`).
- **Fonts:** display/body stacks always end with `var(--font-telugu), var(--font-devanagari)` (tailwind `fontFamily` and `body` in globals.css). Fonts per theme follow `docs/05-theme-references.md`: Luxury = Instrument Serif + Luxurious Script (script initials via `.initial-script`), Romantic = Inria Serif, Hindu = Cinzel + Pinyon Script + Cormorant Garamond body; Hindu stacks end with `--font-devanagari-serif` because Cinzel has no Indic glyphs. All fonts are self-hosted WOFF2 (`next/font/local`, files in `themes/font-files/`, OFL-licensed, ~1.14 MB total) and use `display: "swap", preload: false`; Nursery Sage = Cormorant italic + Inter, Telugu Traditional = Marcellus + Noto Serif Telugu + Cormorant, Midnight Gala = Bodoni Moda + Manrope + JetBrains Mono.
- **Dark surfaces = tokens only.** Luxury has a burgundy velvet header/hero/footer (`--accent-2: #580b1b`) on a cream body (`--bg: #f7ead7`); nothing in shared components assumes light. The site layout wrapper sets `min-h-dvh bg-bg text-fg` so `--bg` actually paints the page.
- **Two radii.** `--radius` is for cards/frames; `--radius-btn` (optional) is for `.btn`, `.btn-ghost`, `.input`. Luxury and Romantic use pill buttons with squared/soft cards.
- **Reference provenance.** Each theme file's header comment names the reference template it was modelled on; palette/type tables live in `docs/05-theme-references.md`. Change tokens there first, then in `vars`.
- **Admin is deliberately plain:** neutral Tailwind palette, 13 px base, utility classes from `globals.css`; no theme tokens. Status colors come from `STATUS_TONE` in `components/ui.tsx`.
- Restrained design, mobile-first, no emojis in UI copy (`CLAUDE.md`).

## Common tasks

### Add a theme (e.g. `GARDEN`)
1. Test first: `apps/web/src/themes/themes.test.ts` (vitest, node environment, no DOM) asserting `Object.keys(THEMES)` equals the `ThemeKey` values and every theme's `vars` has the 12 required keys and `Shell/Hero/Divider` are functions. It fails until the map is complete.
2. Schema: add `GARDEN` to `enum ThemeKey`; `pnpm db:migrate` (name `theme_garden`).
3. `apps/web/src/themes/garden/index.tsx`: copy `romantic/index.tsx`; change `vars`, ornaments, `key: "GARDEN"`, `name`.
4. Register in `themes/index.ts` `THEMES`.
5. Admin: add `{ key: "GARDEN", label: "...", swatch: [bg, accent, surface] }` to `THEMES` in `apps/admin/src/lib/data.ts`; add `"GARDEN"` to the `theme` enum in `EventSettings` (`apps/admin/src/app/studios/[studioId]/events/[eventId]/actions.ts`) and in `NewEventForm`'s schema in `apps/admin/src/app/studios/[studioId]/actions.ts` if it enumerates themes.
6. Seed (optional): a fourth event in `packages/db/prisma/seed.ts` so it is reviewable at `http://<slug>.localhost:3000`.
7. Verify visually (below) in all three locales.

### Add a shared primitive
Put it in `globals.css` under "Shared primitives" using only tokens (`var(--accent)`, `@apply` for spacing). Do not add per-theme classes to shared components; put theme-specific ornaments in the theme file or the ornament block of `globals.css`.

### Add a font
Fonts are self-hosted; never import `next/font/google` (the build must work offline, and a test fails if any file under `apps/` does).
1. Confirm the family is OFL and read its `OFL.txt` for a Reserved Font Name (those ship whole, not subset, and must be added to the allow-list in `fontFiles.test.ts`).
2. Add `fetch`/`build` lines to `themes/font-files/build.sh` (latin + latin-ext for Latin families, the script's own range for Indic) and run it; it writes the WOFF2 and `OFL.txt` into `font-files/<family>/`. Keep the total under 1.2 MB and update the table in `font-files/README.md`.
3. Declare it once in `themes/fonts.ts` with `localFont({ src: [{ path: "./font-files/<family>/<File>.woff2", weight, style }], variable: "--font-xyz", display: "swap", preload: false })` (literal arguments only), append `.variable` to `fontVariableClasses`, add its weights and styles to `EXPECTED_FACES` in `fonts.test.ts`, then reference `var(--font-xyz)` from a theme's `vars`. Keep the Noto fallbacks in the stack.

### Style an admin page
Use `PageHeader`, `Card`, `Table`, `Badge`, `Field`, `Stat`, `LocalizedInputs` from `apps/admin/src/components/ui.tsx` and `ActionForm`/`ActionButton`/`SubmitButton`/`FieldError` from `components/forms.tsx`. Buttons: `btn-primary` for the one main action, `btn-secondary` otherwise, `btn-danger` + `confirm` for destructive.

## Visual check across locales
```bash
pnpm dev:web
# Priya & Arjun has en/te/hi enabled; the other two are en-only (enable locales in admin Settings).
open 'http://priya-arjun.localhost:3000/?lang=te'   # sets hub_lang cookie then redirects
open 'http://priya-arjun.localhost:3000/?lang=hi'
open 'http://sofia-james.localhost:3000/'            # LUXURY (dark)
open 'http://emma-liam.localhost:3000/'              # ROMANTIC
```
Check: nav wraps without overlap, headings in Telugu are not clipped (Telugu glyphs are taller; `leading-tight` headings need testing), hero date line, sign-in gate (open an incognito window), album grid, RSVP table, footer credit. Resize to 375 px.

## Gotchas
- `?lang=` only applies if the locale is in `Event.enabledLocales`; otherwise `getSite()` falls back to `defaultLocale`. The `LangSwitcher` is hidden when fewer than two locales are enabled.
- Tailwind `content` is `./src/**/*.{ts,tsx}` per app; class names built dynamically (`` `text-${x}` ``) are purged. Use full literal class names.
- `themeFor()` silently falls back to luxury for an unknown key -- a missing `THEMES` entry shows up as "everything looks luxury", not an error. The themes test above catches it.
- Admin swatches in `lib/data.ts` are approximations and do not auto-sync with `vars`; update both.
- `--accent-2` is used by ornaments but has no Tailwind color class on purpose; use inline `style` or add it to `tailwind.config.ts` if it becomes common.
- Theme `vars` are applied as an inline `style` on a wrapper `div` inside `<body>`, so `body { background: var(--bg); color: var(--fg) }` resolves to the `:root` light defaults, not the theme's. No Shell currently sets `bg-bg text-fg` on its root `div` (`grep -rn bg-bg apps/web/src` finds only the FaceSearch alert), so the dark Luxury theme most likely renders on the cream default. When touching a Shell, add `bg-bg text-fg` to the `min-h-dvh` root div and verify against `sofia-james.localhost:3000`.
- `next/font` requires module-scope constants and literal arguments; declaring a font inside a component, or building the `src` array from data, throws at build.
- Inter is subset to latin only (latin-ext would put the payload 6,392 bytes over the 1.2 MB budget); `Ł`/`ő` in Inter text fall back to the next family in the stack. Marcellus ships unsubset because its licence reserves the font name.
- The WOFF2 files live beside `fonts.ts` (not in `public/`) because `next/font/local` emits hashed copies into `_next/static/media`; a `public/` copy would be served twice.
- Offline build check on macOS: wrap the build in a `sandbox-exec` profile that denies non-localhost `network-outbound`; a `next/font/google` import fails it with "Failed to fetch ... from Google Fonts".

## Verification
```bash
pnpm --filter @hub/web typecheck
pnpm --filter @hub/web build          # Tailwind compiles, local fonts resolve (no network needed)
pnpm --filter @hub/web build 2>&1 | grep -c googleapis   # 0
pnpm --filter @hub/web test           # once themes.test.ts exists
curl -s -H 'Host: priya-arjun.localhost' http://localhost:3000/ | grep -o 'data-theme="[A-Z_]*"'
```

## References
- `docs/01-architecture.md` §4 (themes share headless components; Noto fallbacks; "every theme tested in all three scripts")
- `docs/04-plan.md` §4 risk "Rendering Indic scripts in luxury display fonts"
- Tailwind v3 theme config: https://v3.tailwindcss.com/docs/theme
- next/font: https://nextjs.org/docs/app/api-reference/components/font
- Related skills: `i18n-localized-content`, `guest-site-patterns`, `nextjs-app-router`
