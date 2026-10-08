---
id: WEB-007
title: "My events" cross-event dashboard at the root domain
labels: [type:feature, area:web, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-002]
epic: EPIC-AUTH
---

## Context
docs/02 §1: one user, many guest rows, "see all the events they attended". docs/04 Phase 2 pairs "My events" with face profiles because auto-matching only pays off at the second event. `apps/web/src/app/root/page.tsx` is currently a placeholder landing.

## Scope
- Root-domain sign-in (`ROOT_DOMAIN` / `app.`-less host): reuse `SignIn` with no event; eligibility = any `ContactPoint` verified or any guest row with that contact; neutral response.
- `/root` → `/events` list for the signed-in user: events where they have a linked `Guest` (not deleted) or `EventMember`, grouped by upcoming/past, each card linking to `eventOrigin(slug)` with title (`t()`), date, role chip, "N photos of you" from `PhotoMatch` count, RSVP summary for their household.
- Session cookie is already host-wide for non-localhost (`cookieDomain()`); on `localhost` document that each `*.localhost` is a separate cookie jar so the dashboard links re-prompt sign-in.
- Hide events with `status: DRAFT` unless the user is a member.

## Out of scope
- Account settings (WEB-006). Custom root domains (WEB-028).

## Acceptance criteria
- [ ] A user with guest rows in two events of two studios sees both; studio names never appear side by side with anything but the event (no studio directory leak).
- [ ] A DRAFT event is hidden from a guest but shown to its host.
- [ ] e2e: sign in at `http://localhost:3000`, see two seeded events (seed adds a second guest row for a shared email).

## Files
- `apps/web/src/app/root/{page.tsx,events/page.tsx,auth/actions.ts}`, `apps/web/src/middleware.ts` (root routing), `apps/web/src/components/SignIn.tsx`
- `packages/db/prisma/seed.ts` (shared guest across events)

## Verification
```bash
pnpm e2e --grep "my events"
```

## Notes for agents
First failing test: DRAFT visibility rule as a unit test over a pure `visibleEventsFor(principal, rows)` function; keep the query thin and the rule pure.
