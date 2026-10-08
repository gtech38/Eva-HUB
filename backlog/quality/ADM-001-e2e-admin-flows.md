---
id: ADM-001
title: e2e: admin sign-in, create event, invite host
labels: [type:feature, area:admin, priority:p0, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-003]
epic: EPIC-QUALITY
---

## Context
Creating an event, picking a theme and inviting a host is the studio's first action for every job. `apps/admin/scripts/smoke-check-event.mts` approximates this manually.

## Scope
Specs under `e2e/specs/admin/`:
- `login.spec.ts`: `admin@localhost` requests a link, Mailpit delivers, callback sets cookie, `/platform` renders; a non-member email gets the same message and no link in Mailpit.
- `create-event.spec.ts`: from `/studios/<id>/events/new` create slug `e2e-<ts>` with theme ROMANTIC, assert redirect to the event overview and that `http://e2e-<ts>.localhost:3000/` renders the sign-in gate with the event title.
- `members.spec.ts`: add a host by email on `/members`; assert `EventMember` row and that the invitation email reaches Mailpit.
- `reauth.spec.ts`: age the session (`UPDATE "Session" SET "authedAt" = now() - interval '13 hours'`) and assert that saving event settings redirects to `/login?reauth=1`.

## Out of scope
- Upload e2e (needs S3 CORS, see SHR-007/ADM-014). CSV import wizard e2e (follow-up once stable).

## Acceptance criteria
- [ ] All four specs pass with `pnpm e2e --project=admin`.
- [ ] The re-auth spec proves the 12 h gate in `packages/shared/src/policy.ts` is enforced through `authorize()` in a real request.
- [ ] Created events are deleted in `afterAll` so reruns do not accumulate rows.

## Files
- `e2e/specs/admin/*.spec.ts` (new)
- Read: `apps/admin/src/app/login/actions.ts`, `apps/admin/src/app/studios/[studioId]/events/new/NewEventForm.tsx`, `apps/admin/src/app/studios/[studioId]/actions.ts` (`createEvent`), `apps/admin/src/lib/auth.ts`

## Verification
```bash
pnpm e2e --project=admin
```

## Notes for agents
First failing test: `login.spec.ts`. Reuse `signInAdmin` from INF-003. Event slugs must be unique per studio (`@@unique([studioId, slug])`).
