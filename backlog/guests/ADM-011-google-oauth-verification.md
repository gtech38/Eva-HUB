---
id: ADM-011
title: Google OAuth app verification for the contacts scope (external)
labels: [type:chore, area:admin, priority:p2, size:S]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [LEG-003]
epic: EPIC-GUESTS
---

## Context
docs/04 long-lead items: "Google OAuth app verification for the contacts scope (a sensitive scope) — Google review, plus privacy policy and demo video." Not agent work; tracked here so ADM-010 has a real blocker.

## Scope
Human checklist:
- [ ] Create the Google Cloud project and OAuth consent screen (External), brand name = studio name, support email.
- [ ] Add scope `https://www.googleapis.com/auth/contacts.readonly` and justification text ("import a wedding guest list chosen by the host").
- [ ] Publish privacy policy (LEG-003) and terms at public URLs on the studio domain (INF-019).
- [ ] Record the demo video of the import flow on a staging deploy.
- [ ] Submit for verification; respond to reviewer questions; record approval date here.
- [ ] Put the client id/secret in the production secret store (DOC-005).

## Out of scope
- Any code.

## Acceptance criteria
- [ ] Verification approved; `GOOGLE_CLIENT_ID` configured in production.

## Files
- none

## Verification
Approval email from Google; ADM-010 works for a non-test Google account.

## Notes for agents
Do not attempt this ticket; it requires a human with the Google account.
