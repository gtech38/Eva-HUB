---
id: INF-018
title: Production docker compose example with Caddy wildcard DNS-01 TLS
labels: [type:chore, area:infra, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-015, INF-014]
epic: EPIC-DEPLOY
---

## Context
docs/01 §2: "TLS / routing: Caddy or Traefik in front, with wildcard certs via DNS-01." docs/01 §11 lists `infra/Caddyfile`. The first deployment is one studio on one VPS (or a small PaaS); this ticket gives a complete, copyable example that DOC-006 explains.

## Scope
- `infra/docker-compose.prod.yml`: services `caddy` (custom image `infra/caddy/Dockerfile` with the DNS provider module via `xcaddy`, ports 80/443, volumes for data/config), `web`, `admin`, `worker` (images from INF-015 by tag `${IMAGE_TAG}`), optional `postgres` and `rustfs` for self-hosted mode behind a profile `selfhost` (default assumes managed Postgres and R2 via env), `mailpit` absent; `env_file: .env.production`; `depends_on` with health conditions; restart policies; resource limits for the worker.
- `infra/Caddyfile`: `*.{$ROOT_DOMAIN}, {$ROOT_DOMAIN}` with `tls { dns <provider> {$CADDY_DNS_API_TOKEN} }`; `@admin host app.{$ROOT_DOMAIN}` → `reverse_proxy admin:3001`; else → `reverse_proxy web:3000`; `header -Server`; `encode zstd gzip`; request id header pass-through (`X-Request-Id`); access logs JSON; a commented `on_demand_tls` block wired to WEB-027.
- Worker is not exposed; web reaches it on the compose network (`WORKER_INTERNAL_URL=http://worker:8010`); admin internal endpoint (SHR-005) reachable only from the network.
- `infra/.env.production.example` with every variable DOC-005 documents.
- Smoke script `infra/smoke.sh <domain>` curling health endpoints and the sign-in gate over TLS.

## Out of scope
- Kubernetes/Helm. Multi-node.

## Acceptance criteria
- [ ] `docker compose -f infra/docker-compose.prod.yml config` validates with the example env.
- [ ] On a test VM with INF-019 DNS, Caddy obtains the wildcard cert and `infra/smoke.sh` passes (documented run with timestamps in the PR).
- [ ] Locally, `docker compose -f infra/docker-compose.prod.yml --profile selfhost up` with `ROOT_DOMAIN=localhost` and Caddy `tls internal` serves `https://priya-arjun.localhost` (self-signed) — automated in CI as a compose config + container start check.

## Files
- `infra/docker-compose.prod.yml`, `infra/Caddyfile`, `infra/caddy/Dockerfile`, `infra/.env.production.example`, `infra/smoke.sh` (new)

## Verification
```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production.example config
./infra/smoke.sh localhost
```

## Notes for agents
First check: `compose config` validity in CI. Caddy's `tls internal` is the local stand-in for DNS-01; keep both documented in the Caddyfile comments.
