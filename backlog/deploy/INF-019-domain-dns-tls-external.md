---
id: INF-019
title: Studio domain purchase, wildcard DNS and TLS prerequisites (external)
labels: [type:chore, area:infra, priority:p0, size:S]
milestone: Phase 1 — MVP
epic: EPIC-DEPLOY
---

## Context
docs/04 §3 "Still open: The real studio domain. It's needed before Phase 1 launch, for DNS, TLS and email authentication. Everything references ROOT_DOMAIN until then." Blocks INF-018, DOC-002, INF-011, INF-009.

## Scope
Human checklist:
- [ ] Choose and register the studio domain (and decide whether a separate platform domain is wanted for SaaS later).
- [ ] Put DNS on a provider with an API supported by Caddy's DNS-01 modules (Cloudflare recommended; also gives R2 and CDN).
- [ ] Create `A/AAAA` for `app.<domain>` and wildcard `*.<domain>` → proxy IP; `mail.<domain>` for email (DOC-002).
- [ ] Create an API token scoped to DNS edit for that zone; store as `CADDY_DNS_API_TOKEN` (DOC-005).
- [ ] Set `ROOT_DOMAIN` in the production env; confirm the seed/admin `Domain` rows use it.
- [ ] Record registrar, renewal date and DNS provider here.

## Out of scope
- Code (ROOT_DOMAIN is already the single config point).

## Acceptance criteria
- [ ] `dig +short app.<domain>` and `dig +short anything.<domain>` resolve to the proxy; the token works with `caddy` DNS-01 in INF-018.

## Files
- none

## Verification
`dig` output and a successful certificate issuance log from Caddy.

## Notes for agents
Not agent work.
