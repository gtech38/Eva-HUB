---
id: EPIC-DEPLOY
title: Deployment: containers, TLS, environments, runbooks
labels: [type:epic, area:infra, priority:p1, size:L]
milestone: Phase 1 — MVP
---

## Context
Nothing is deployed and nothing can be: there are no Dockerfiles, the Next apps do not use `output: "standalone"`, there is no reverse proxy or TLS configuration, no env/secrets documentation, and no runbook for migrations. docs/01 §2 fixes the shape: Docker images, Postgres + pgvector, S3-compatible bucket (R2 recommended), Caddy or Traefik with wildcard DNS-01 TLS, 12-factor env. The real domain is still undecided (`ROOT_DOMAIN` placeholder), itself a long-lead item.

## Children
- INF-019 Studio domain, wildcard DNS and TLS prerequisites (external)
- INF-015 Dockerfiles for web, admin (standalone) and worker
- INF-018 Production docker compose example with Caddy wildcard TLS
- DOC-005 Environment variables and secrets reference
- DOC-006 Provider-agnostic deployment guide with migration and rollout runbook
- WEB-027 Caddy on-demand TLS `ask` endpoint backed by the Domain table
- WEB-028 Custom root domains and cross-domain session handshake
- DOC-020 Verify and record encryption in transit and at rest, and worker access, per environment

## Definition of Done
- [ ] `docker compose -f infra/docker-compose.prod.yml up` on a fresh VM with DNS pointed serves `app.<domain>` and `<slug>.<domain>` over TLS.
- [ ] Every env var is documented with default, required-in-prod flag and owner.
- [ ] A migration can be rolled out and rolled back following the runbook, tested on staging once.
