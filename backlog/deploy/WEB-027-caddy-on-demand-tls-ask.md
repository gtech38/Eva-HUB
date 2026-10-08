---
id: WEB-027
title: Caddy on-demand TLS `ask` endpoint backed by the Domain table
labels: [type:feature, area:web, area:infra, priority:p3, size:S, agent-ready]
milestone: Phase 3 — SaaS readiness
depends_on: [INF-018]
epic: EPIC-DEPLOY
---

## Context
docs/01 §3: "Custom root domains use Caddy on-demand TLS with an ask endpoint that checks the Domain table." Without the `ask` gate, on-demand TLS lets anyone pointing DNS at the proxy trigger certificate issuance (rate-limit abuse).

## Scope
- Route `apps/web/src/app/api/caddy/ask/route.ts`: `GET ?domain=<host>` → 200 if a `Domain` row exists with `hostname = host` and `verifiedAt IS NOT NULL`, else 404; no session; constant-time-ish (single indexed lookup); 60 s in-process cache; rate limited per source IP via SHR-003 helper; accessible only from the Caddy container (shared header `X-Caddy-Ask-Token` or network ACL in the Caddyfile).
- Caddyfile: `on_demand_tls { ask http://web:3000/api/caddy/ask }` and a second site block `https://` catch-all with `tls { on_demand }` for non-wildcard hosts.
- Admin: `Domain` management (add custom hostname, show DNS instructions `CNAME → app.<ROOT_DOMAIN>`, "Verify" button that checks the CNAME/TXT via `node:dns` and sets `verifiedAt`); owner only; audited `domain.add/verify/remove`.
- Tests: route 200/404 logic; verification helper with mocked DNS.

## Out of scope
- Session sharing across root domains (WEB-028). Billing for custom domains.

## Acceptance criteria
- [ ] `GET /api/caddy/ask?domain=unknown.example` → 404; for a verified `Domain` → 200 (vitest with Postgres).
- [ ] Unverified domain → 404 even if the row exists.
- [ ] Admin verify sets `verifiedAt` when the CNAME points to `app.<ROOT_DOMAIN>` (mocked DNS unit test).

## Files
- `apps/web/src/app/api/caddy/ask/route.ts` (new), `infra/Caddyfile`, `apps/admin/src/app/studios/[studioId]/domains/{page.tsx,actions.ts}` (new), `apps/admin/src/lib/dns.ts` + test

## Verification
```bash
pnpm --filter @hub/web test && pnpm --filter @hub/admin test
```

## Notes for agents
First failing test: unverified → 404. Keep the handler free of Prisma extension overhead (direct indexed `findUnique` on `hostname`).
