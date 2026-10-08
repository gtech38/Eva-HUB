---
id: DOC-002
title: SPF, DKIM and DMARC setup for the sending domain
labels: [type:chore, area:docs, area:infra, priority:p1, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-019]
epic: EPIC-MESSAGING
---

## Context
docs/04 long-lead items: "Email domain authentication (SPF, DKIM, DMARC) on the sending domain — DNS propagation, and reputation warm-up — Phase 1." Magic links and invitations are the product's front door; landing in spam blocks the MVP.

## Scope
- `docs/deploy/email-dns.md`: records for the chosen provider (SHR-012) and for the SMTP fallback: SPF (`v=spf1 include:<provider> -all`), DKIM selector(s), DMARC starting at `p=none; rua=mailto:dmarc@<domain>` with a schedule to move to `quarantine` then `reject`; `From` subdomain recommendation (`mail.<ROOT_DOMAIN>`) so the apex reputation is isolated; return-path/CNAME; BIMI optional.
- Warm-up plan: daily volume ramp for the first two weeks; monitor bounce/complaint via SHR-012 statuses.
- Verification script `scripts/check-email-dns.mjs <domain>` using `node:dns` to resolve and lint the three records (prints PASS/FAIL per record); runnable before launch and in a scheduled CI job.
- `EMAIL_FROM` guidance in `.env.example`.

## Out of scope
- Buying the domain (INF-019). Provider account creation (part of SHR-012 rollout).

## Acceptance criteria
- [ ] `node scripts/check-email-dns.mjs example.com` runs and reports FAIL for all three records; against a correctly configured domain reports PASS (unit test with mocked `dns.resolveTxt`).
- [ ] The doc lists exact record values with placeholders only for the provider-issued tokens.

## Files
- `docs/deploy/email-dns.md`, `scripts/check-email-dns.mjs`, `scripts/check-email-dns.test.mjs` (new), `.env.example`

## Verification
```bash
node scripts/check-email-dns.mjs localhost
node --test scripts/check-email-dns.test.mjs
```

## Notes for agents
First failing test: the mocked DNS lint. Do not hardcode a provider; make the include target a parameter.
