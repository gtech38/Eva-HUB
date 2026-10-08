---
id: WEB-030
title: Resolve the event site from the trusted x-hub-host in getSite()
labels: [type:tech-debt, area:web, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
epic: EPIC-SITE
---

## Context
WEB-014 (#126) made middleware overwrite `x-hub-host` from `Host` on every request and made `/og.png` resolve its event from that header only, because `X-Forwarded-Host` is client-controlled. `getSite()` in `apps/web/src/lib/site.ts` still takes `x-forwarded-host ?? host`, so two code paths on the same site disagree about which host a request is for: middleware routes by `Host`, pages resolve by `X-Forwarded-Host`. Pages are `private, no-store`, so this is not a cache-poisoning risk today, but it is the same trust mistake, it makes `metadataBase` and the `og:image` origin steerable, and it would become a hole the day any page response is cached or sits behind a shared CDN. Found in the WEB-014 review and proposed there as follow-up (a).

## Scope
- `getSite()` reads the host from `x-hub-host` (`HUB_HOST_HEADER`, `hostOf` in `apps/web/src/lib/hubHost.ts`) and never from `x-forwarded-host` or `host`. A missing `x-hub-host` yields `null` (404), the same behaviour as `/og.png`.
- Extract the host selection into a small pure function (for example `siteHostFromHeaders(headers: Headers): string | null` in `lib/hubHost.ts`) so the rule is unit-testable without Next's request context; delete `hostFromHeaders` from `site.ts`.
- Check that every caller of `getSite()` or `resolveEvent()` is behind the middleware matcher (server actions, `app/api/**` handlers, `sites/[slug]/**` pages). If one is not, extend the matcher rather than falling back to `Host`.
- Update the `guest-site-patterns` skill row for `lib/site.ts` to say the host is the trusted `x-hub-host`.

## Out of scope
- `apps/admin` host handling. Changing how middleware computes `x-hub-host`. Making any page response cacheable.

## Acceptance criteria
- [ ] A unit test shows `siteHostFromHeaders` returns the `x-hub-host` value even when `Host` and `X-Forwarded-Host` carry different values, and returns `null` when `x-hub-host` is absent.
- [ ] With `Host: priya-arjun.localhost` and `X-Forwarded-Host: sofia-james.localhost`, the rendered sign-in page title and `og:title` are Priya & Arjun's.
- [ ] `grep -rn "x-forwarded-host" apps/web/src` finds no production (non-test) use.
- [ ] `pnpm verify` passes.

## Files
- `apps/web/src/lib/site.ts`, `apps/web/src/lib/hubHost.ts`, `apps/web/src/lib/hubHost.test.ts`
- Read: `apps/web/src/middleware.ts`, `apps/web/src/lib/ogResponse.ts`, `apps/web/src/app/sites/[slug]/layout.tsx`
- `.claude/skills/guest-site-patterns/SKILL.md`

## Verification
```bash
pnpm --filter @hub/web test -- hubHost
pnpm verify
grep -rn "x-forwarded-host" apps/web/src | grep -v "test\."
# with the web app running on :3000 (pnpm dev:web) and the stack seeded:
curl -s -H 'Host: priya-arjun.localhost' -H 'X-Forwarded-Host: sofia-james.localhost' http://127.0.0.1:3000/ | grep -o '<title>[^<]*</title>'
```

## Notes for agents
Write the `hubHost.test.ts` cases first and watch them fail on the missing function. `getSite` is wrapped in React `cache` and calls `headers()`, so test the pure helper, not `getSite`. Keep `hubHost.ts` edge-safe (no Node imports). Do not add a `Host` fallback "for tests": inject the header in the test instead.
