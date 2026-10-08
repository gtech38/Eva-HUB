---
id: WRK-010
title: 'Face-profile lifecycle: "we found N photos" notice, lastUsedAt refresh, stale on model change'
labels: [type:feature, area:worker, area:web, priority:p1, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [SHR-005]
epic: EPIC-FACE
---

## Context
`CLUSTER_FACES._match_profiles` writes `PhotoMatch(PROFILE_AUTO)` but never notifies the user, never refreshes `FaceProfile.lastUsedAt/purgeAfter` (so the 3-year purge clock runs from enrolment, not use), and nothing marks profiles `stale` when `MODEL_VERSION` changes. docs/01 §6 "Remember my face": notify "We found 23 photos of you at Priya & Arjun's wedding"; "After a model change, a profile is marked stale and the user is asked for a fresh selfie."

## Scope
- `_match_profiles`: when new matches are written for a user in this run (count of inserted rows > 0, not updates), `UPDATE "FaceProfile" SET "lastUsedAt" = now(), "purgeAfter" = now() + interval '3 years'` and insert `Message(purpose: GALLERY_READY → add FACE_MATCHES to MessagePurpose, channel EMAIL)` + `SEND_MESSAGE {template: "face_matches", count, eventId}` with `dedupe_key face-matches:<eventId>:<userId>:<day>` so bursts coalesce to one email per day.
- `_match_profiles` must skip guests with `Guest.faceSearchOptOut = true` (it joins `Guest` but ignores the flag; also tracked in WRK-020). Added from the LEG-005 review: without it an operator's event-scoped delete of a person's matches is undone by the next `CLUSTER_FACES`.
- Only notify when the event is `LIVE` and `galleryPublishedAt` is set.
- Stale handling: `_match_profiles` selects only `modelVersion = MODEL_VERSION`; a startup check in `__main__.py` marks `FaceProfile.stale = true` where `modelVersion <> MODEL_VERSION` (audited `faceprofile.stale`, count); web `gallery/me/page.tsx` shows "Your saved face signature needs a fresh selfie" when `stale` and the search route resets `stale=false` on a new `remember=on` search (it already upserts).
- Web `/api/face/search`: on a self search by a user with a profile, also refresh `lastUsedAt/purgeAfter` (currently only on upsert path — verify and test).
- pytest: notification created once per day per user; `lastUsedAt` advanced; stale profile excluded and marked.

## Out of scope
- Rendering the email (SHR-013 template `face_matches`). Purge jobs (WRK-012).

## Acceptance criteria
- [ ] Clustering an event with a matching profile inserts one `Message(FACE_MATCHES)` and advances `lastUsedAt`; re-running the same day inserts no second message.
- [ ] A profile with a different `modelVersion` is marked `stale` at worker start and never matched.
- [ ] Web shows the stale prompt and clears it after a new remembered search (vitest render + route test).

## Files
- `workers/media/hub_worker/handlers/cluster_faces.py`, `workers/media/hub_worker/__main__.py`, `workers/media/tests/test_profiles.py` (new)
- `packages/db/prisma/schema.prisma` (MessagePurpose) + migration
- `apps/web/src/app/sites/[slug]/gallery/me/page.tsx`, `apps/web/src/app/api/face/search/route.ts`

## Verification
```bash
cd workers/media && make test -- -k profiles
pnpm --filter @hub/web test
```

## Notes for agents
First failing test: one message per user per day. Do not store match counts anywhere biometric; the message payload carries only `count` and `eventId`.
