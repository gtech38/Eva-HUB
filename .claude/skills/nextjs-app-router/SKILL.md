---
name: nextjs-app-router
description: Use when adding pages, layouts, server actions, route handlers or middleware in apps/web or apps/admin (Next 15 App Router, React 19). Covers the hostname middleware and /sites/[slug] rewrite, force-dynamic, the authorize()/act() server-action pattern, route handlers for downloads and face search, principalFromCookie sessions, revalidatePath, client/server boundaries (@hub/shared subpath imports only in client code), dotenv in next.config.ts, dev ports.
---

# Next.js App Router (apps/web, apps/admin)

## When this applies
- New page/layout/route handler/server action in either app.
- Reading the session, cookies or `Host` in server code.
- Build errors about Node modules in client bundles, `params` being a Promise, or `headers()` being async.

## Where things live

| Concern | web (`apps/web/src`) | admin (`apps/admin/src`) |
|---|---|---|
| Hostname -> tenant | `middleware.ts` rewrites `{slug}.ROOT_DOMAIN/*` to `/sites/{slug}/*`, root host to `/root/*` | none (single host `localhost:3001`) |
| Request context | `lib/site.ts` `getSite()` / `requireViewer()` (React `cache`) | `lib/auth.ts` `getPrincipal()`, `requireAdmin()`, `requireSignedIn()`, `requirePlatformAdmin()` |
| Session cookie | `lib/session.ts` `setSessionCookie()` / `clearSessionCookie()` | inline in `app/auth/callback/route.ts` |
| Server actions | `app/sites/[slug]/{auth,rsvp,gallery}/actions.ts` | `app/**/actions.ts` wrapped in `act()` from `lib/action.ts` |
| Route handlers | `app/api/face/search/route.ts`, `app/api/photos/[id]/download/route.ts`, `app/api/health/route.ts`, `app/robots.txt/route.ts`, `app/sites/[slug]/{auth,i}/**/route.ts`, `app/sites/[slug]/og.png/route.tsx` (the one public response) | `app/api/upload/route.ts`, `app/auth/{callback,signout}/route.ts`, `.../guests/report/export/route.ts`, `.../guests/import/template/route.ts` |
| Client components | `components/SignIn.tsx`, `components/gallery/*`, `components/Countdown.tsx` | `components/forms.tsx`, `ThemePicker.tsx`, `*/Uploader.tsx`, `*/PageEditor.tsx`, `*/InviteComposer.tsx`, `*/EventTabs.tsx` |
| Config | `next.config.ts`: dotenv `../../.env`, `transpilePackages`, `serverExternalPackages` (incl. `satori`, `@resvg/resvg-js`), `Cache-Control: private, no-store` + `X-Robots-Tag` headers on everything except `/og.png` (which keeps `X-Robots-Tag` and sets its own Cache-Control) | `next.config.ts`: same dotenv, `serverActions.bodySizeLimit: "4mb"` |

## Conventions in this repo
- **Every page, layout and route handler exports `export const dynamic = "force-dynamic"`.** Nothing is public, so nothing is statically rendered (18 files in web, 32 in admin). No `unstable_cache`, no `revalidateTag` -- invalidation is `revalidatePath(...)` after a write.
- **Single exception: `/og.png`** on event hosts is the one public, visitor-independent, network-free response (`public, max-age=86400` + ETag). Its route is wiring around `lib/ogResponse.handleOgRequest` (trusted `x-hub-host` -> `resolveEvent` -> `ogCardForEvent` -> in-process LRU keyed by `(event.id, event.updatedAt)` -> buffered PNG or `500 private, no-store`); rendering is satori + resvg with committed fonts and no remote assets. Do not read `getSite()`, cookies or the session there, and do not add a second public route.
- **Next 15 async APIs:** `const { slug } = await params;` `const sp = await searchParams;` `await headers()`, `await cookies()`. Route handlers take `ctx: { params: Promise<{ id: string }> }`.
- **Middleware is edge-safe: no Prisma.** `middleware.ts` only parses `Host`, handles `?lang=`, and forwards `x-hub-slug` / `x-hub-path` request headers plus `x-hub-host` (`lib/hubHost.ts`), which it always overwrites from `Host` so handlers can trust it. The Domain/Event lookup happens in `lib/site.ts` (Node runtime). The `/sites` and `/root` folders are not `_`-prefixed; they are unreachable by literal path because every matched request is rewritten (a literal `/sites/x` becomes `/sites/<host-slug>/sites/x` -> 404). The matcher lists `/og.png`, `/sites/:path*` and `/root/:path*` explicitly so this holds for static-file extensions too; `src/middleware.test.ts` checks it with `unstable_doesMiddlewareMatch`.
- **Server action pattern (admin):** `act(async () => { const p = await requireSignedIn(); authorize(p, "<action>", { studioId, eventId }); ...Zod.parse...; await audit({...}); revalidatePath(...); return { ok: true, message }; })`. `act()` turns ZodError into `fieldErrors`, rethrows Next redirects/notFound, and never leaks stack traces. Forms use `<ActionForm action={fn}>` + `<FieldError name>` from `components/forms.tsx` (`useActionState`).
- **Server action pattern (web):** `const site = await requireViewer(); if (!site || !site.viewer.can("rsvp.respond")) ...` then scope every query by `event.id` (see `rsvp/actions.ts`, `gallery/actions.ts`).
- **Authorization is `can()` only** (`@hub/shared/policy`). The UI hides; the action re-checks. `authorize()` redirects to `/login?reauth=1` when the only failure is the 12 h gate.
- **Session reading:** `principalFromCookie(jar.get(SESSION_COOKIE)?.value)` wrapped in React `cache()` so layout + page + action share one DB round-trip.
- **Route handlers exist only where a browser needs a URL**: downloads (302 to presigned GET), face search (multipart upload), CSV export/template, auth callbacks, upload proxy. Everything else is a server action.
- **Client/server boundary:** client files import only `@hub/shared/i18n`, `@hub/shared/pages` and types. The root `@hub/shared` pulls S3/nodemailer/node:crypto. Server components may import anything. `Theme` objects (`themes/*`) are server components that receive plain props.
- **Hostnames:** `eventOrigin(slug)` / `siteOrigin(site)` build `http://{slug}.localhost:3000` in dev, `https://{slug}.{ROOT_DOMAIN}` otherwise. Cookies are host-only on localhost (`cookieDomain()` returns undefined) because browsers reject `Domain=localhost`.

## Common tasks

### Add a guest-site page (e.g. `/party`)
1. Test first: `apps/web/src/lib/party.test.ts` (vitest: `describe/it/expect` from `vitest`) asserting a pure helper, e.g. `partyMembers(parsePage("WEDDING_PARTY", content), locale)` returns localized `role` strings. Run it with `cd apps/web && pnpm exec vitest run src/lib/party.test.ts` or `pnpm --filter @hub/web test`.
2. Create `apps/web/src/app/sites/[slug]/party/page.tsx`: `export const dynamic = "force-dynamic"`; `const site = await requireViewer(); if (!site) return null;` read content with `parsePage("WEDDING_PARTY", page(site, "WEDDING_PARTY")?.content)`; render with `PageHeader` and `t()`.
3. The nav already lists `WEDDING_PARTY` when an enabled `EventPage` row exists (`buildNav` in `sites/[slug]/layout.tsx`); `PAGE_PATHS.WEDDING_PARTY` is `/party`.
4. Verify: `curl -sI -b "hub_session=<cookie>" http://priya-arjun.localhost:3000/party` -> 200 and `Cache-Control: private, no-store`.

### Add an admin server action
1. Test first: put the Zod schema in a plain module (e.g. `apps/admin/src/lib/schemas/thing.ts`) and write `thing.test.ts` asserting accept/reject cases (remember `EmailSchema` accepts `admin@localhost`).
2. In the route folder's `actions.ts` (`"use server"`): `export async function saveThing(_p: ActionState, fd: FormData) { return act(async () => { ... }); }` using `str/opt/bool/localized` from `lib/action.ts`.
3. Call `authorize(p, action, { studioId, eventId })`, filter DB queries by `eventId` (and `studioId`), `audit({...})`, `revalidatePath(...)`.
4. UI: `<ActionForm action={saveThing}>` with hidden `studioId`/`eventId` inputs.
5. Verify with a minted session (see `admin-app-patterns`) or in the browser; check the Audit page at `/platform/audit`.

### Add a route handler
```ts
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const site = await requireViewer();                       // web
  if (!site) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  ...
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
```
Keep the JSON error shape `{ ok: false, reason }` (see `lib/face.ts` `FaceSearchReason`). API routes are excluded from middleware (`matcher` skips `api/`), so read `Host` yourself via `getSite()`.

### Add a client component
Start with `"use client"`, receive strings already resolved by the server (`galleryStrings(locale)` pattern in `lib/gallery-strings.ts`), call server actions directly (`toggleFavorite` in `PhotoGrid.tsx`). Never import `prisma` or root `@hub/shared`.

## Gotchas
- Forgetting `await` on `params`/`cookies()`/`headers()` type-checks in some positions and fails at runtime.
- `redirect()` inside `act()` works only because `isNextControlFlow()` rethrows `NEXT_REDIRECT`; a plain `try/catch` around a redirect swallows it.
- `revalidatePath("/studios/x", "layout")` is used when the sidebar (event list/title) changes; plain path otherwise.
- `apps/web/.env` is a symlink so Next's own loader finds env in worker processes; admin relies on `__dirname` in `next.config.ts`. Both apps read the same root `.env`.
- The sign-in action must always return the same message (`ui("signInSent")`) -- see `auth-sessions-policy`.
- `images: { unoptimized: true }`; use plain `<img>` with eslint-disable comments as the gallery does; presigned URLs cannot go through `next/image`.
- Dev ports are fixed in `package.json` (`next dev -p 3000|3001`); `WEB_PORT`/`ADMIN_PORT` in `.env` must match or email links break.
- `*.localhost` resolves to 127.0.0.1 in Chrome/Safari/Firefox without `/etc/hosts`; `curl` needs `--resolve priya-arjun.localhost:3000:127.0.0.1` or a `Host:` header.

## Verification
```bash
pnpm --filter @hub/web typecheck && pnpm --filter @hub/admin typecheck
pnpm --filter @hub/web build        # catches client-bundle imports of server-only modules
curl -s http://localhost:3000/api/health            # {"ok":true}
curl -sI -H 'Host: priya-arjun.localhost' http://localhost:3000/ | grep -i -E 'cache-control|x-robots'
curl -s http://localhost:3001/login | grep -c 'Admin sign-in'
```

## References
- `docs/01-architecture.md` §3 (routing; note the doc says `/_sites/[eventId]` with a 60 s in-process Domain cache -- the code rewrites to `/sites/[slug]` and resolves `Domain` per request in `lib/site.ts`) and §4 (says content is cached with `unstable_cache`/`"use cache"` -- not implemented; everything is `force-dynamic`)
- Next 15 upgrade notes (async request APIs): https://nextjs.org/docs/app/guides/upgrading/version-15
- Server actions: https://nextjs.org/docs/app/getting-started/updating-data
- Related skills: `admin-app-patterns`, `guest-site-patterns`, `auth-sessions-policy`, `tailwind-themes`
