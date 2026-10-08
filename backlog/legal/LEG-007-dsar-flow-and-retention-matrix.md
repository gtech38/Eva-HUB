---
id: LEG-007
title: 'DSAR / "delete my data" flow spec and data retention matrix'
labels: [type:chore, area:legal, area:docs, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-LEGAL
---

## Context
WEB-006 adds a "Delete my data" button that only records a request; nobody has defined what deletion means for a guest whose RSVP the host still needs, whose face appears in other people's photos, or whose order has a receipt. Every retention decision scattered across docs (face index 30–730 d, profile 3 y, invite tokens event+90 d, zips until change, audit classes in ADM-023) needs one table.

## Scope
- `docs/compliance/retention-matrix.md`: table of every data class/table → owner (controller), purpose, retention period, trigger, mechanism (job/manual/cascade), backup overlap, evidence (audit action). Include: User/ContactPoint, Session/LoginToken/InviteToken, Guest/Household/Rsvp, Message, Photo originals/derivatives/zips, Face/FaceCluster, FaceProfile, PhotoMatch, BiometricConsent, Favorite/ProofingList, Order/Entitlement/Contribution, AuditLog classes, WebhookEvent, RateLimit, logs/traces.
- `docs/compliance/dsar.md`: intake (account settings button → `dsar.requested` audit + email to studio owners; also a mailto for people without accounts), identity verification (OTP on a verified contact), scope decisions per request type (access/export, rectification, deletion) with the rules: deletion anonymises `Guest` rows (name → "Guest", contacts null) rather than deleting RSVP counts the host relies on until the event ends + 90 d; deletes `PhotoMatch`, `Favorite`, `FaceProfile`, `ContactPoint`, sessions/tokens; keeps `Order`/`Contribution` financial records (legal retention) with the user pointer anonymised; photos of the person are **not** deleted (studio's copyright; host content) — explain; response deadlines (30/45 days), templates for replies, logging via `dsar.completed`.
- Export spec: JSON bundle contents for an access request (`scripts/compliance/export-user.mjs <userId>` producing the bundle without embeddings).
- Follow-up ticket list for automation (e.g. `ADM-0xx DSAR console`), referenced not created.

## Out of scope
- Implementing deletion automation (future ticket once counsel confirms rules). Legal review (LEG-006).

## Acceptance criteria
- [ ] Every Prisma model in `schema.prisma` appears in the retention matrix (script `scripts/compliance/matrix-coverage.mjs` compares; wired to `pnpm lint`).
- [ ] `export-user.mjs` runs against the seed admin user and contains no `embedding` field (unit test on output).
- [ ] DSAR doc states the anonymise-vs-delete rule per table and the deadlines.

## Files
- `docs/compliance/{retention-matrix.md,dsar.md}`, `scripts/compliance/{matrix-coverage.mjs,export-user.mjs}` + test (new), `package.json`

## Verification
```bash
node scripts/compliance/matrix-coverage.mjs
node scripts/compliance/export-user.mjs <userId> | jq 'paths | select(.[-1]=="embedding")'   # empty
```

## Notes for agents
First failing test: matrix coverage (will list every model). Mark counsel-dependent rows with `[COUNSEL]`.
