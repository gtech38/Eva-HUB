---
name: admin-app-patterns
description: Use when building or changing anything in apps/admin (studio/platform/host management on :3001): requireAdmin()/requirePlatformAdmin(), the authorize() + act() server-action wrapper, Zod form parsing helpers (str/opt/bool/localized, EmailSchema for TLD-less seed emails), page/layout structure per studio and event, ui.tsx/forms.tsx components, smoke scripts in apps/admin/scripts/*.mts and minting a session for curl, and adding a new admin page end-to-end with a test.
---

# Admin app patterns (apps/admin)

## When this applies
- New admin page, tab, form, table or server action.
- Permission or redirect behaviour in admin.
- Scripted checks against admin data.

## Where things live

| Path | What |
|---|---|
| `src/app/layout.tsx` | root html/body only (no auth) |
| `src/app/page.tsx` | `requireAdmin()` then redirect: platform admin -> `/platform`, one studio -> `/studios/{id}`, else `/studios` |
| `src/app/login/{page,actions,LoginForm}.tsx` | magic-link login; notices via `?reauth=1`, `?denied=1`, `?expired=1`, `?signedout=1` |
| `src/app/auth/{callback,signout}/route.ts` | session mint / destroy |
| `src/app/platform/{layout,page,jobs,audit,users}/` + `actions.ts` | platform admin: studios list + `createStudio`, Jobs (`retryJob`), Audit, Users |
| `src/app/studios/page.tsx` | studio switcher when a user has several |
| `src/app/studios/[studioId]/{layout,page,settings,staff,contacts,pricing}/` + `actions.ts` | studio scope: `requireAdmin(studioId)`, `Shell` sidebar with Studio + Events sections |
| `src/app/studios/[studioId]/events/new/` | `NewEventForm` + `createEvent` |
| `src/app/studios/[studioId]/events/[eventId]/{layout,page,settings,members,pages,schedule,guests,invites,gallery,registry}/` + `actions.ts` | event scope: breadcrumb header, `EventTabs`, one `actions.ts` for settings/members/pages/schedule/registry, separate `actions.ts` under `guests/`, `invites/`, `gallery/` |
| `src/lib/auth.ts` | `getPrincipal`, `authorize`, `isStale`, `requireSignedIn`, `requireAdmin`, `requirePlatformAdmin`, `visibleStudios` |
| `src/lib/action.ts` | `ActionState`, `act()`, `fromZod()`, `formObject()`, `str/bool/opt/localized`, `EmailSchema()` |
| `src/lib/data.ts` | `getStudio`, `getEvent` (both `notFound()` on miss, React `cache`), `studioEvents`, `THEMES` swatches, `PAGE_ORDER` |
| `src/lib/{audit,users,guests,invites,csv,format}.ts` | `audit()`, `userForEmail()` (unverified contact, never links guests), `syncInvites()`, invite copy, RFC-4180 CSV, `lt/fmt*/slugify/fullName/pct` |
| `src/components/{Shell,ui,forms,ThemePicker}.tsx` | layout + primitives (see `tailwind-themes` for classes) |
| `src/app/api/upload/route.ts` | server-side upload proxy (see `s3-object-storage`) |
| `scripts/smoke-*.mts` | `smoke-session` (mint cookie + ids), `smoke-upload`, `smoke-check-event`, `smoke-check-invites`, `smoke-check-settings` |
| `next.config.ts` | dotenv root `.env`, `serverActions.bodySizeLimit: "4mb"`, `eslint.ignoreDuringBuilds: true` |

## Conventions in this repo
- **Layouts gate, pages assume.** `studios/[studioId]/layout.tsx` calls `requireAdmin(studioId)` (404 for outsiders, `/login?reauth=1` when stale); pages still call `requireAdmin(studioId)` for the principal and compute `canX = can(p, "...", res)` to disable forms (`<fieldset disabled={!canEdit}>` + a read-only notice). Actions re-check with `authorize()`.
- **Every mutation is a server action `(prev: ActionState, fd: FormData) => Promise<ActionState>` wrapped in `act()`**, in the route folder's `actions.ts` with `"use server"`. Hidden inputs carry `studioId`/`eventId`; the action re-loads the event scoped by both (`loadEvent(studioId, eventId)`), never trusting ids alone.
- **Form parsing:** `str(fd, k)` trimmed string, `opt()` -> `null` when empty, `bool()` for checkboxes, `localized(fd, "title")` -> `{en?,te?,hi?}` from `title.en|te|hi` inputs (`LocalizedInputs`), `fd.getAll()` for multi-checkbox. Then `Schema.parse(...)` with Zod; `act()` converts `ZodError` to `fieldErrors` keyed by path (`title.en`), shown by `<FieldError name="title.en" />`.
- **`EmailSchema()` instead of `z.string().email()`** because seed/dev addresses are `admin@localhost` (no TLD).
- **Return shape:** `{ ok: true, message? }` or `{ ok: false, error, fieldErrors? }`. `ActionForm` renders the global error/success line; `ActionButton` is for one-click actions with `confirm` text and hidden `fields`.
- **After a write:** `audit({...})` then `revalidatePath(path)` (`"layout"` variant when sidebar/title changes). Pages are `force-dynamic`.
- **Data loaders in `lib/data.ts` use React `cache`** so layout and page share one query per request.
- **Tenancy:** queries filter `{ id, eventId }` or `{ id, eventId, event: { studioId } }`; the studio layout already guarantees `studioId` access.
- **UI vocabulary:** `PageHeader` (title, description, crumbs, actions), `Card` (title, actions, `padded={false}` for tables), `Table head={[...]}`, `StatusBadge`, `Stat`, `Field` (label/help/error), `Empty`. Tabs for an event come from `EventTabs` (`TABS` const). English only, no emojis.

## Common tasks

### Mint a session for curl
```bash
cd apps/admin && pnpm exec tsx scripts/smoke-session.mts admin@localhost
# {"cookie":"...","studioId":"...","eventId":"...","userId":"..."}
curl -s -b "hub_session=$COOKIE" http://localhost:3001/studios/$STUDIO/events/$EVENT/guests | grep -c '<table'
```
Other smoke scripts take a slug (`smoke-upload.mts <slug>`) or none; run with `pnpm exec tsx` from `apps/admin` (they load `../../../.env` themselves).

### Add an admin page end-to-end (e.g. event `/proofing` tab)
1. Test first (pure logic): `src/lib/proofing.test.ts` with node:test asserting e.g. `summarizeSelections(lists)` counts; and a Zod schema test for the form (`ProofingListInput.parse` accepts/rejects). Add `"test": "node --import tsx --test 'src/**/*.test.ts'"` to `apps/admin/package.json` if absent.
2. Schema check: `ProofingList` already exists in Prisma; add fields/migration only if needed (`prisma-postgres`).
3. Action: in `src/app/studios/[studioId]/events/[eventId]/proofing/actions.ts` export `saveProofingList` via `act()`: `requireSignedIn` -> `authorize(p, "proofing.edit", { studioId, eventId })` -> `loadEvent` -> parse -> write -> `audit({ action: "proofing.save" })` -> `revalidatePath(base + "/proofing")`.
4. Page: `proofing/page.tsx` (`force-dynamic`): `const p = await requireAdmin(studioId); const event = await getEvent(studioId, eventId); const canEdit = can(p, "proofing.edit", res);` render `Card` + `ActionForm` with hidden ids and `<fieldset disabled={!canEdit}>`.
5. Tab: add `["/proofing", "Proofing"]` to `TABS` in `EventTabs.tsx`.
6. Verify: typecheck, test, then curl the page with a minted cookie (200), submit in the browser, check `/platform/audit` for `proofing.save`.

### Add a studio-level page
Same, under `studios/[studioId]/<page>/page.tsx`; add the link to the `sections` array in `studios/[studioId]/layout.tsx`; actions in `studios/[studioId]/actions.ts`; permission usually `studio.manage` (OWNER) or `studio.view`.

### Add a platform page
Under `src/app/platform/<page>/`; layout already enforces `requirePlatformAdmin()`; add to the hard-coded Platform list in `components/Shell.tsx`; actions in `platform/actions.ts` with `authorize(p, "platform.admin", { studioId: "" })`.

### Add a CSV export/import
Export: route handler returning `toCsv(rows)` with `Content-Disposition` and an `audit` row (`guests/report/export/route.ts`). Import: `csvRecords(text)` gives snake_case headers; see `guests/import/ImportWizard.tsx` + `guests/actions.ts` for the dry-run pattern; template at `guests/import/template/route.ts`.

## Gotchas
- `requireAdmin()` without a studioId only checks "has any studio role or is platform admin"; always pass `studioId` in studio routes.
- `authorize()` calls `redirect()` for stale sessions -- it must run inside `act()` (which rethrows `NEXT_REDIRECT`) or directly in a page, never inside a plain `try/catch`.
- `notFound()` from `getEvent()` renders the 404 even for a real event in another studio (deliberate: no cross-studio enumeration).
- Server action body limit is 4 MB; file uploads go through presigned PUT or `/api/upload`, not actions.
- `ActionForm` resets only when `resetOnSuccess`; edit forms keep values. `useActionState` state persists across re-renders -- a second submit shows the previous message until the new result arrives.
- `fd.get("x")` returns `"on"` for checked boxes and is absent when unchecked; use `bool()`.
- `prisma.job.id` and `auditLog.id` are `BigInt`: `String(j.id)` in keys and `BigInt(str(fd,"id"))` in `retryJob`.
- `eslint.ignoreDuringBuilds` is on; `next lint` is not part of `pnpm verify`. Typecheck is the gate.
- `userForEmail()` creates UNCLAIMED users with unverified contacts for members/staff; they can sign in only after clicking an admin magic link (which verifies). It never links `Guest` rows (see `auth-sessions-policy`).

## Verification
```bash
pnpm --filter @hub/admin typecheck && pnpm --filter @hub/admin build
cd apps/admin && pnpm exec tsx scripts/smoke-check-event.mts && pnpm exec tsx scripts/smoke-check-settings.mts
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/platform          # 307 -> /login when signed out
```

## References
- `CLAUDE.md` Rules (authorization, tenancy)
- `docs/02-users-and-roles.md` §3-4 (roles, matrix)
- Next server actions and forms: https://nextjs.org/docs/app/getting-started/updating-data
- React `useActionState`: https://react.dev/reference/react/useActionState
- Related skills: `nextjs-app-router`, `auth-sessions-policy`, `tailwind-themes`, `email-sms-adapters`, `s3-object-storage`
