# ADR-0007: apps/admin is a separate Next.js app from apps/web

- Status: Accepted
- Date: 2026-10-08
- Tickets: INF-015, INF-018, SHR-005, DOC-012

## Context

docs/01 (diagram and section 11) put the studio and host dashboards inside one `web` container, with `app.yourstudio.com` routed to them by middleware. The guest app is the opposite shape: every request on `{slug}.ROOT_DOMAIN` is rewritten by hostname to `/sites/[slug]`, and it is the public-facing surface. The management UI has a different audience (platform admins, studio staff, hosts) and holds the higher-privilege actions.

## Decision

Two Next.js 15 apps share code only through packages. `apps/web` (port 3000) serves guest event sites; its middleware maps `ROOT_DOMAIN` and `app.ROOT_DOMAIN` to a small `/root` page that links to the admin and every other host to `/sites/[slug]`. `apps/admin` (port 3001, `ADMIN_ORIGIN`) serves platform, studio and host management, upload, invitations, jobs and audit, with no host-based routing. Both use `@hub/db` and `@hub/shared`, the same `hub_session` cookie format and `AUTH_SECRET`, and `can()` for authorisation; neither imports from the other. Cross-app needs go through shared packages, the database, or HTTP.

## Consequences

- Hostname routing stays simple: the admin never has to coexist with wildcard tenant rewrites, and it can be deployed, scaled and restarted independently of guest traffic.
- There are three deployable services (web, admin, worker), not two as docs/01 says; DOC-012 updates the docs, and INF-015 and INF-018 build and run all three.
- Duplicated app plumbing (session cookie helpers, `authorize()`, layout) is accepted; anything genuinely shared must be lifted into `packages/shared`.
- The admin is always deployed and not tied to an event host, which is why the worker-to-admin internal endpoint in ADR-0008 lives there.
- A signed-in user must sign in on each origin unless the cookie domain is shared: `cookieDomain()` returns `.ROOT_DOMAIN` for any `ROOT_DOMAIN` other than `localhost`, and no domain (host-only) when it is `localhost`.

## Alternatives

- One app with the dashboards under `app.ROOT_DOMAIN` (the original plan): one deploy, but guest and management traffic, releases and failure modes are coupled, and the middleware has to special-case the admin host alongside tenant hosts.

## References

- `apps/web/src/middleware.ts`
- `apps/web/src/app/root/page.tsx`
- `apps/admin/package.json`
- `apps/admin/src/lib/auth.ts`
- `packages/shared/src/env.ts`
- `docs/01-architecture.md` section 11
