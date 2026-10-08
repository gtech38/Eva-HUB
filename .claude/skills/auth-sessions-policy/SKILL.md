---
name: auth-sessions-policy
description: Use when working on sign-in, sessions, invitation links, magic links, guest-to-user linking, or permissions: packages/shared/src/auth.ts and policy.ts, the hub_session cookie, createSession, INVITE_LINK scope, LoginToken/InviteToken (hash-only), resolveUserForVerifiedContact/linkGuestsForContact, the can() matrix and policy.test.ts, the 12h re-auth gate, adding an Action, and enumeration-safe sign-in responses.
---

# Auth, sessions and policy

## When this applies
- Any change to who can do what (`can()`), to sign-in flows, or to how a `Guest` becomes a `User`.
- New server action or route that needs a permission check.
- Token/cookie handling.

## Where things live

| Path | What |
|---|---|
| `packages/shared/src/auth.ts` | `SESSION_COOKIE = "hub_session"`, `newToken()`, `hashToken()`, `encodeCookie()/decodeCookie()` (HMAC-SHA256 with `AUTH_SECRET`), `createSession()`, `destroySession()`, `normalizeContact()`, `principalFromCookie()`, `resolveUserForVerifiedContact()`, `linkGuestsForContact()` |
| `packages/shared/src/policy.ts` | `Principal`, `Action` union, `Resource`, `ELEVATED` set, `REAUTH_HOURS = 12`, `can()` |
| `packages/shared/src/policy.test.ts` | vitest suite; `pnpm --filter @hub/shared test` |
| `packages/shared/src/env.ts` | `AUTH_SECRET` (min 16 chars; in production hex/base64 decoding to ≥ 32 bytes and no dev placeholder: a format and length check, see `productionIssues()`), `SESSION_TTL_DAYS` (30), `INVITE_SESSION_TTL_DAYS` (90; an INVITE_LINK session is also capped at its token's expiry, see `sessionExpiry()`), `cookieDomain()` |
| `apps/web/src/app/sites/[slug]/auth/actions.ts` | `requestSignIn` server action (guest-site magic link, email or SMS) |
| `apps/web/src/app/sites/[slug]/auth/callback/route.ts` | magic-link landing: burn token, resolve user, link guests, `createSession(EMAIL_LINK|SMS_OTP)` |
| `apps/web/src/app/sites/[slug]/i/[token]/route.ts` | invitation link: `inviteUsable()` (`lib/inviteLink.ts`), resolve user, link that guest row, `createSession("INVITE_LINK", { guestScopeEventId, inviteExpiresAt, now })`; every dead link redirects to `/?invite=expired` (no cookie, `lastUsedAt` untouched), where `SignIn` shows the `inviteExpired` heading (`lib/inviteNotice.ts`) |
| `apps/web/src/app/sites/[slug]/auth/signout/route.ts`, `apps/web/src/lib/session.ts` | sign-out; cookie options (`httpOnly`, `sameSite: lax`, `secure` off on localhost, `domain: cookieDomain()`) |
| `apps/admin/src/app/login/actions.ts`, `app/auth/callback/route.ts`, `app/auth/signout/route.ts` | admin magic link (email only; eligible = platform admin or studio member) |
| `apps/admin/src/lib/auth.ts` | `getPrincipal()`, `authorize()`, `isStale()`, `requireSignedIn()`, `requireAdmin()`, `requirePlatformAdmin()` |
| `apps/web/src/lib/site.ts` | `getSite()` builds `Viewer` with `can` bound to `{ studioId, eventId }`; rejects INVITE_LINK sessions scoped to another event |
| `docs/02-users-and-roles.md` | identity model, §4 permission matrix |

## Conventions in this repo
- **Cookie = `<sessionId>.<base64url HMAC>`.** `decodeCookie` uses `timingSafeEqual`; a bad signature is `null`, never an exception. The cookie carries no claims; everything is loaded from `Session` + `User` per request.
- **Tokens are stored hashed only** (`tokenHash = sha256(token)`, `@unique`). `LoginToken` (magic link, 15 min, single use via `updateMany({ usedAt: null })` so a double click cannot mint two sessions) and `InviteToken` (per guest per channel, expires at event end + 90 d via `inviteExpiry()` in `packages/shared/src/invites.ts` (latest sub-event end, else `startsOn`; `now + 180d` without dates), reusable until `revokedAt`, `lastUsedAt` stamped).
- **`authMethod` decides scope.** `INVITE_LINK` sessions get `guestScopeEventId`, a TTL of min(90 days, the token's expiry) -- the `createSession` overloads make `{ guestScopeEventId, inviteExpiresAt }` required at compile time -- and `can()` returns false for every `ELEVATED` action regardless of roles. Magic-link sessions are `EMAIL_LINK` (or `SMS_OTP` for SMS delivery) with a 30-day TTL.
- **Re-auth gate:** elevated actions also fail when `authedAt` is older than 12 h. Admin `authorize()` turns that specific case into `redirect("/login?reauth=1")`; a real denial throws `ForbiddenError`.
- **Platform admin bypasses role checks but not the INVITE_LINK rule** (tested).
- **Guest linking happens only on a verified contact.** `resolveUserForVerifiedContact(kind, value)` finds-or-creates the `User` owning that `ContactPoint` and marks it verified; `linkGuestsForContact(userId, kind, value)` attaches unlinked `Guest` rows whose host-typed email/phone equals it, skipping events where the user already has a guest row. The invite route links its own single guest row the same way (contact verified by delivery). `apps/admin/src/lib/users.ts` `userForEmail()` creates users with an **unverified** contact point and never links guests.
- **Enumeration-safe responses:** guest sign-in always returns `ui("signInSent", locale)`; admin login always returns `SAME_MESSAGE` and even writes a dummy `LoginToken` for unknown addresses so timing is similar. Callbacks redirect to `/?error=link` / `/login?expired=1` for every failure reason.
- **Audit:** `auth.magic_link` and `auth.invite_link` rows are written on success.
- `normalizeContact()` lower-cases emails and coerces 10-digit numbers to `+1XXXXXXXXXX`.

## `can()` cheat sheet (from `policy.ts`)

| Action | Who |
|---|---|
| `platform.admin` | platform admin only |
| `studio.manage`, `event.create`, `event.settings`, `entitlements.grant` | studio OWNER |
| `studio.view` | OWNER or STAFF |
| `event.content.edit` | OWNER, assigned STAFF (studio STAFF + event STAFF role), HOST, COHOST, PLANNER |
| `event.members.manage` | OWNER, HOST |
| `guests.manage`, `invites.send` | OWNER, HOST, COHOST, PLANNER |
| `rsvp.report` | OWNER, STAFF, HOST, COHOST, PLANNER, VENDOR (attending headcount and meal totals) |
| `rsvp.report.names` | OWNER, assigned STAFF (studio STAFF + event STAFF role), HOST, COHOST, PLANNER (names, response counts, household figures, name-level exports; not VENDOR, not unassigned staff) |
| `rsvp.respond`, `face.search`, `favorites` | linked guest, HOST, COHOST |
| `registry.manage`, `proofing.edit` | HOST, COHOST (+OWNER for registry) |
| `photos.upload`, `albums.manage` | OWNER, assigned STAFF |
| `photos.hide` | OWNER, assigned STAFF, HOST, COHOST |
| `gallery.view` | OWNER, STAFF, HOST, COHOST, PLANNER, VENDOR, guest |
| `gallery.view.hostsOnly` | OWNER, STAFF, HOST, COHOST |
| `site.view` | OWNER, STAFF, any event role, guest |

Elevated (INVITE_LINK + 12 h gate apply): everything except `rsvp.respond`, `gallery.view`, `gallery.view.hostsOnly`, `face.search`, `favorites`, `site.view`.

## Common tasks

### Add an Action (e.g. `registry.claim`)
1. Test first: add a `test(...)` to `packages/shared/src/policy.test.ts` asserting who may and may not (guest yes, INVITE_LINK guest yes if non-elevated, other-studio owner no). Run `pnpm --filter @hub/shared test` -- it fails to compile on the unknown action.
2. Add the literal to the `Action` union; add it to `ELEVATED` if it is a management action.
3. Add a `case` in the `switch` (the switch is exhaustive; TypeScript errors until you do).
4. Add the row to `docs/02-users-and-roles.md` §4 so the matrix and code stay aligned.
5. Use it: `authorize(p, "registry.claim", res)` in admin or `viewer.can("registry.claim")` in web.

### Mint a session for curl / smoke tests
```bash
cd apps/admin && pnpm exec tsx scripts/smoke-session.mts admin@localhost
# -> {"cookie":"<id>.<sig>","studioId":"...","eventId":"...","userId":"..."}
curl -s -b 'hub_session=<cookie>' http://localhost:3001/platform/jobs | head -c 300
curl -s -b 'hub_session=<cookie>' -H 'Host: priya-arjun.localhost' http://localhost:3000/rsvp | head -c 300
```
`createSession(userId, "EMAIL_LINK")` is what the script calls; pass `"INVITE_LINK", { guestScopeEventId: eventId, inviteExpiresAt }` to reproduce guest scope.

### Read a magic link from Mailpit (for scripted sign-in)
```bash
curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].ID' \
 | xargs -I{} curl -s http://localhost:8025/api/v1/message/{} | jq -r '.Text' | grep -o 'http[^ ]*callback?token=[^ ]*'
```
Then `curl -si "<link>"` and copy `Set-Cookie: hub_session=...`.

### Add a sign-in method (e.g. email OTP)
Write a `policy.test.ts`-style unit test for the new `LoginToken` purpose check first; reuse `LoginTokenPurpose.OTP` and `newOtp()` (already in `auth.ts`), hash the code with `hashToken`, create the session with `authMethod: "EMAIL_OTP"`. Keep the same-message rule.

## Gotchas
- `principalFromCookie` returns `null` for expired sessions, deleted or DISABLED users; nothing deletes expired `Session` rows yet.
- A HOST who signs in through a forwarded invitation link is a guest for that session (`authMethod: INVITE_LINK`); the UI shows `NotYou` so they can get their own link. Admin `requireSignedIn()` bounces INVITE_LINK sessions to `/login?reauth=1`.
- `guestScopeEventId` makes an invite session invisible on other event subdomains (`scopedElsewhere` in `getSite()`), even though the user may be a guest there too.
- `can()` ignores `Resource.eventId` for studio-level actions but roles in another studio grant nothing (tested: "tenant isolation").
- Cookies on `localhost` are host-only; a session on `priya-arjun.localhost` does not carry to `sofia-james.localhost` in dev (it will in production via `Domain=.yourstudio.com`).
- `docs/02` §4 says planners/vendors may create face profiles; `can()` gives `face.search` to hosts/guests only. The code is authoritative until the doc is updated.
- Vendors' "meal counts only" is `rsvp.report` without `rsvp.report.names`. The data functions enforce it, not the UI: `loadRsvpReport(principal, resource, opts)` and `loadWideCsv(principal, resource)` in `apps/admin/src/lib/guests.ts` take the principal, derive access through `can()` (`reportAccess()`), return null when denied, and in totals mode never select name/contact columns nor return invited/declined/pending or household figures. Never add a loader that accepts a bare access string. Name-level export attempts by non-name users are audited as `rsvp.export.denied`.
- Changing `AUTH_SECRET` invalidates every cookie (signature) but not the `Session` rows.

## Verification
```bash
pnpm --filter @hub/shared test                 # policy matrix
pnpm typecheck
# enumeration check: both must print the same body
curl -s -X POST -d 'contact=nobody@example.com' -H 'Host: priya-arjun.localhost' http://localhost:3000/  # via UI form in practice
```
Manual: sign in at `http://localhost:3001/login` as `admin@localhost`, open Mailpit `http://localhost:8025`, click the link; try a `/i/<bogus>` URL on an event site and confirm redirect to `/?invite=expired`, where the sign-in form shows "This link has expired".

## References
- `docs/02-users-and-roles.md` §2 (linking rules), §4 (matrix)
- `docs/01-architecture.md` §9 (recommends Better Auth -- not used; auth is the self-contained implementation in `auth.ts`)
- Node `crypto.timingSafeEqual`: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- Related skills: `admin-app-patterns`, `guest-site-patterns`, `email-sms-adapters`
