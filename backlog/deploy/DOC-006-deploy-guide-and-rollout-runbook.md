---
id: DOC-006
title: Provider-agnostic deployment guide with CDN rules and migration/rollout runbook
labels: [type:chore, area:docs, area:infra, priority:p1, size:M, agent-ready]
milestone: Phase 1 — MVP
depends_on: [INF-018, DOC-005, SHR-008]
epic: EPIC-DEPLOY
---

## Context
docs/01 §2 says it "runs on Fly, Railway, Render, ECS, Cloud Run, Hetzner + Coolify, or a bare VPS" and recommends R2. No provider has been chosen. The guide must let one person deploy to any of them in an afternoon, and must say how migrations ship safely (`prisma migrate deploy` is not run in images per INF-015).

## Scope
- `docs/deploy/README.md`: topology (Caddy → web/admin, worker private, managed Postgres with pgvector, R2 bucket + custom domain for `PUBLIC_DERIVATIVE_BASE_URL`), sizing for a single studio (2 vCPU web/admin, 4 vCPU worker), steps per path: (a) VPS with docker compose (INF-018), (b) PaaS (Fly/Railway generic: one app per image, private networking, env from DOC-005, volumes none), (c) managed Postgres enabling `vector`/`citext` extensions; R2 setup (bucket, CORS from SHR-007, custom domain, cache rules), CDN cache rules for `d/*/thumb-*` and `webWm-*` (long TTL, ignore query), never caching HTML (`Cache-Control: private, no-store` already set) and never caching `orig/` or `web-` clean images.
- `docs/ops/runbook-rollout.md`: release = tag → images with `GIT_SHA` → run `prisma migrate deploy` from a one-off container **before** starting the new web/admin (expand/contract pattern: additive migrations first, destructive in a later release), start worker last, verify health + `infra/smoke.sh`, rollback = previous image tag + (only if needed) `prisma migrate resolve --rolled-back`; checklist for data migrations (backfills as idempotent scripts); maintenance mode via Caddy `respond 503` snippet.
- `docs/ops/runbook-incidents.md` (short): worker down, queue stuck (`requeue_stale`), S3 unreachable, certificate renewal failure, Stripe webhook backlog (replay from dashboard), how to read logs (SHR-015) and the error tracker (INF-014).
- Link the ADRs (DOC-010) for the storage/queue decisions.
- Per deploy path, a step that sets `TRUSTED_PROXY_HOPS` from evidence (SHR-003): send a request with `X-Forwarded-For: 198.51.100.1` through the real proxy chain, log the header web receives, and set N so the real client address is exactly N entries from the right (platforms differ; GCP's external Application Load Balancer appends two). Then confirm that the startup log has no `[clientIp] no client address` warning.

## Out of scope
- Terraform/IaC. Multi-region.

## Acceptance criteria
- [ ] `docs/deploy/README.md`, `docs/ops/runbook-rollout.md` and `docs/ops/runbook-incidents.md` exist and `README.md` links to `docs/deploy/README.md` (`grep -c 'docs/deploy/README.md' README.md` ≥ 1).
- [ ] Every relative link in `docs/deploy/**` and `docs/ops/**` resolves to a file in the repo — the link-check one-liner in Verification exits 0.
- [ ] Every `pnpm <script>`, `node <path>` and `make <target>` command in a fenced block of those files exists in `package.json` `scripts`, under `scripts/`, or as a target in `workers/media/Makefile` — the command-check one-liner exits 0.
- [ ] Every `<PLACEHOLDER>` token used in a fenced block of those files is a variable listed in `docs/deploy/env.md` (DOC-005) — the placeholder one-liner exits 0.
- [ ] `node scripts/env-docs.mjs --check` still passes.

## Files
- `docs/deploy/{README.md,cdn.md,storage.md}`, `docs/ops/{runbook-rollout.md,runbook-incidents.md}` (new or extended), `README.md` (link)

## Verification
```bash
grep -c 'docs/deploy/README.md' README.md
node scripts/env-docs.mjs --check

# Relative links resolve.
node -e '
const fs=require("fs"),p=require("path");
const files=fs.readdirSync("docs",{recursive:true}).map(f=>p.join("docs",f)).filter(f=>/^docs\/(deploy|ops)\/.*\.md$/.test(f));
let bad=0;
for (const f of files) for (const m of fs.readFileSync(f,"utf8").matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
  const t=m[1]; if (/^[a-z]+:/.test(t)) continue;
  if (!fs.existsSync(p.resolve(p.dirname(f),t))) { console.log(`${f}: broken link ${t}`); bad++; }
}
process.exit(bad?1:0)'

# Fenced pnpm/node/make commands exist.
node -e '
const fs=require("fs"),p=require("path");
const scripts=Object.keys(JSON.parse(fs.readFileSync("package.json","utf8")).scripts);
const targets=[...fs.readFileSync("workers/media/Makefile","utf8").matchAll(/^([a-z][\w-]*):/gm)].map(m=>m[1]);
const builtin=new Set(["install","i","add","exec","dlx","run","-r","--filter","-w"]);
const files=fs.readdirSync("docs",{recursive:true}).map(f=>p.join("docs",f)).filter(f=>/^docs\/(deploy|ops)\/.*\.md$/.test(f));
let bad=0;
for (const f of files) for (const b of fs.readFileSync(f,"utf8").match(/```[\s\S]*?```/g)??[]) for (const l of b.split("\n")) {
  const m=l.trim().match(/^(pnpm|node|make)\s+(\S+)/); if(!m) continue;
  const ok=m[1]==="node"?fs.existsSync(m[2]):m[1]==="make"?targets.includes(m[2]):builtin.has(m[2])||scripts.includes(m[2]);
  if(!ok){ console.log(`${f}: ${l.trim()}`); bad++; }
}
process.exit(bad?1:0)'

# Placeholders are defined in the env reference.
node -e '
const fs=require("fs"),p=require("path");
const env=fs.readFileSync("docs/deploy/env.md","utf8");
const files=fs.readdirSync("docs",{recursive:true}).map(f=>p.join("docs",f)).filter(f=>/^docs\/(deploy|ops)\/.*\.md$/.test(f));
let bad=0;
for (const f of files) for (const b of fs.readFileSync(f,"utf8").match(/```[\s\S]*?```/g)??[]) for (const m of b.matchAll(/<([A-Z][A-Z0-9_]+)>/g)) {
  if (!env.includes(m[1])) { console.log(`${f}: undefined placeholder <${m[1]}>`); bad++; }
}
process.exit(bad?1:0)'
```

## Notes for agents
Write the runbook as numbered steps with expected output after each. Where a provider differs, use a short per-provider subsection rather than hedging prose. A walkthrough of the VPS path on a fresh VM, and one rollout on staging with a real migration, are strongly recommended before merging; note timings and doc fixes in the PR, but they are not acceptance criteria because nothing in CI can assert them.
