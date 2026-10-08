---
id: WEB-028
title: Custom root domains with cross-domain session handshake
labels: [type:feature, area:web, priority:p3, size:M, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [WEB-027]
epic: EPIC-DEPLOY
---

## Context
docs/01 §3: "The session cookie is set on .yourstudio.com... Custom root domains can't share that cookie, so they will need a redirect handshake through app. (Phase 3)." `resolveEvent()` already checks the `Domain` table first, so routing works; only auth does not.

## Scope
- Handshake: on a custom-domain site with no session, the sign-in gate offers the normal OTP/magic-link flow (works as-is, cookie host-only) **and** a "Continue with your existing sign-in" link → `https://app.<ROOT_DOMAIN>/auth/handoff?to=<custom-origin>&event=<id>`; if the user has a session on `app.`, mint a one-time `LoginToken(purpose: HANDOFF)` (add enum value) bound to the target origin and event with 60 s expiry, redirect to `<custom-origin>/auth/callback?token=`, which creates a host-only session there (same `authMethod`, same `authedAt` so the re-auth gate is unaffected).
- Allowed targets: only origins whose hostname is a verified `Domain` row (prevents open redirect).
- Cookie settings: `cookieDomain()` returns undefined for hosts not under `ROOT_DOMAIN` (host-only cookie); `siteOrigin()` uses the request host for custom domains.
- Sign-out on a custom domain only clears that host's cookie; "sign out everywhere" deletes the `Session` row (already) and is offered in `/account`.
- Tests: redirect target validation; handoff token single-use and bound to origin; e2e with a second `Domain` row mapped to `custom.localhost` pointing at the seeded event.

## Out of scope
- Issuing certificates (WEB-027). Per-domain branding.

## Acceptance criteria
- [ ] `?to=https://evil.example` is rejected (unit).
- [ ] A handoff token used on a different origin than bound fails; used twice fails (vitest with Postgres).
- [ ] e2e: signed in on `localhost:3000`, visit `http://custom.localhost:3000/`, click continue, land signed in.

## Files
- `apps/web/src/app/root/auth/handoff/route.ts` (new), `apps/web/src/app/sites/[slug]/auth/callback/route.ts`, `apps/web/src/lib/{site.ts,session.ts}`, `packages/shared/src/{env.ts,auth.ts}`, `packages/db/prisma/schema.prisma` (enum) + migration, `e2e/specs/web/custom-domain.spec.ts`

## Verification
```bash
pnpm --filter @hub/web test && pnpm --filter @hub/shared test
pnpm e2e --grep "custom domain"
```

## Notes for agents
First failing test: open-redirect rejection. Local e2e needs `custom.localhost` which resolves automatically in Chromium; seed a `Domain` row for it in the spec.
