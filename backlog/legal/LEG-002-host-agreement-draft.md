---
id: LEG-002
title: Host agreement draft (guest notification duty, face-index retention, content responsibility)
labels: [type:chore, area:legal, area:docs, priority:p0, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-LEGAL
---

## Context
docs/01 §6: "The host agreement makes the host responsible for notifying guests" about face indexing; docs/04 risk mitigation lists it alongside notices in the invitation, RSVP page and gallery. Nothing exists. The studio signs this with each client; later (ADM-024) studios accept the platform terms and hosts accept this per event.

## Scope
- `legal/host-agreement/v1/host-agreement.en.md` (English only; hosts are the studio's clients): parties (studio ↔ host; platform as processor), what the site and gallery do, host duties (accurate guest list, lawful basis to invite, **inform guests that photos may be face-indexed** using the provided notice text, not forward personal links), face search terms (opt-in searches, studio-set retention window 30–730 days, host may request purge or disabling, "remove me" available to guests), content (host owns content, grants display licence), photos (studio owns copyright, licences to host per package), payments (package unlock, prints by guests), data retention after the event (site stays available; face index purged; deletion on request per LEG-007), liability caps, governing law Texas.
- Companion `legal/notices/v1/guest-face-notice.{en,te,hi}.md`: the short notice hosts must include (the invitation template already carries one sentence; align wording with SHR-013 templates).
- Admin: event creation flow records `Event.hostAgreementVersion` and `hostAgreementAcceptedAt` (+ migration) when the host first signs in to admin (checkbox with the text); studio can download the PDF (render markdown → PDF via `md-to-pdf` in a script, not at runtime).
- Test: version front matter present; acceptance recorded and audited `legal.host_agreement.accept`.

## Out of scope
- Legal review (LEG-006). E-signature integration.

## Acceptance criteria
- [ ] Agreement and notice files exist with `version` front matter; unit test checks presence and that the invitation template contains the notice sentence verbatim.
- [ ] A host's first admin sign-in requires acceptance; the event stores version and timestamp (vitest with Postgres).
- [ ] `pnpm legal:pdf` produces `legal/dist/host-agreement-v1.pdf`.

## Files
- `legal/host-agreement/v1/host-agreement.en.md`, `legal/notices/v1/guest-face-notice.*.md`, `scripts/legal-pdf.mjs` (new), `packages/db/prisma/schema.prisma` + migration, `apps/admin/src/app/studios/[studioId]/events/[eventId]/layout.tsx` (acceptance gate), `packages/shared/src/templates/invitation.ts`

## Verification
```bash
pnpm --filter @hub/admin test
pnpm legal:pdf && ls legal/dist
```

## Notes for agents
Write as a draft for counsel: bracketed `[COUNSEL: ...]` notes where a legal judgment is needed. Do not present it as reviewed.
