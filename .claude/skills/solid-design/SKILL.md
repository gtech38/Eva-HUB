---
name: solid-design
description: SOLID and boundary rules as they apply to this codebase — single-responsibility module layout, the adapter interfaces (storage/email/sms/payments/print lab) and how to extend them without modifying callers, Liskov-safe strategy objects, keeping server actions thin, dependency direction between apps/packages/workers, and the heuristics the post-edit hook warns about. Load during the refactor step and in code review.
---

# SOLID design in this repo

## When this applies
Refactor step of TDD, adding a provider/adapter, adding a job type, designing a new module, reviewing a PR. The post-edit hook prints `WARN` lines from these rules.

## Dependency direction (never reverse it)

```
apps/web, apps/admin  ──►  packages/shared  ──►  packages/db  ──►  Postgres
workers/media         ──►  (SQL contracts documented in docs/01 §5–6 and skills)
```

- Apps never import from each other. Shared code goes in `packages/shared`.
- `packages/shared` never imports from an app. It knows nothing about Next.js.
- `packages/db` has no business rules; `enqueue()` is the one allowed helper.
- The Python worker shares *contracts* (table shapes, job payloads, `/embed-selfie` JSON), not code.

## S — Single responsibility

| Smell | Fix used here |
|---|---|
| A server action that validates, authorises, queries, sends email and redirects | Action = `authorize()` + parse + call one `lib/` function + redirect. Logic lives in `lib/` and is unit-tested. See `apps/admin/src/lib/action.ts`. |
| A `lib/site.ts`-style module growing past ~300 lines | Split by concern: resolution (`getSite`), viewer (`principal→viewer`), navigation (`buildNav`). |
| Handler doing I/O and math | Pure functions for math (`normalize_bbox`, `quality_score` in `hub_worker/face.py`), thin handler for I/O. Pure parts get the unit tests. |

Hook warns at >400 lines/file, >80-line functions, >15 imports, >12 public methods.

## O — Open/closed via adapters

Every external capability is an interface + implementations selected by env. Adding a provider = new file, no caller changes.

| Capability | Interface | Implementations | Selector |
|---|---|---|---|
| Email | `EmailSender` (`packages/shared/src/email.ts`) | `SmtpSender`, `ConsoleSender` | `EMAIL_PROVIDER` |
| SMS | `SmsSender` (`sms.ts`) | `ConsoleSms` | `SMS_PROVIDER` |
| Storage | functions in `storage.ts` over an `S3Client`; Python `hub_worker/storage.py` | any S3-compatible endpoint | `S3_*` env |
| Jobs | `Job` table + handler registry (`hub_worker/jobs.py` `HANDLERS`) | one module per type | job `type` |
| Themes | `Theme` type (`apps/web/src/themes/types.ts`) | `luxury`, `romantic`, `hinduTraditional` | `Event.theme` |
| Payments / print lab | **to be created** as `PaymentProvider`, `PrintLab` interfaces (docs/01 §8) | Stripe, fake lab | env |

Rule: callers import the interface/factory (`email()`, `sms()`), never a concrete class. New behaviour for one provider goes in that provider, not in an `if (provider === "twilio")` in the caller.

## L — Liskov

- Every `Theme` must render every `ShellProps`/`HeroProps` combination (empty monogram, null `heroUrl`, Telugu title). A theme that throws on missing data breaks the contract — guard inside the theme.
- Every job handler accepts the documented payload and either returns normally (SUCCEEDED) or raises (retry/backoff). No handler may swallow errors and return success.
- Every `SmsSender`/`EmailSender` returns `{providerId}`; the console ones return a synthetic id rather than `undefined`.

## I — Interface segregation

- `Principal` exposes only what `can()` needs. Don't widen it with view-model fields; build view models in the app (`viewer` in `apps/web/src/lib/site.ts`).
- Shared subpath exports exist so clients can import `@hub/shared/i18n` without dragging nodemailer. Keep root `index.ts` for server code only.
- Admin pages take a `studioId`/`eventId` scope, not the whole session.

## D — Dependency inversion

- Business rules depend on `can()` and the adapter interfaces, not on Prisma shapes or Next APIs. Pass data in; don't reach for `cookies()` or `prisma` deep inside pure logic.
- Tests substitute fakes at the interface (recording `EmailSender`, in-memory job list, fake worker returning a 128-d embedding as `apps/web`'s face route was tested).

## Configuration is declared once
Every environment variable is declared in exactly one parser (`env.ts` for web/admin, `DEFAULTS` in `workers/media/hub_worker/config.py` for the worker) plus its metadata in `scripts/env-meta.mjs`; new TypeScript code reads `env()`, not `process.env`. `pnpm env:docs` regenerates `.env.example` and `docs/deploy/env.md`, and `--check` (in `pnpm lint` and CI) fails on drift.

## Boundaries that are also security rules
- Authorisation only via `can()`; UI hides, server decides.
- Tenant scope on every query (`eventId`, `studioId`); the hook flags unscoped `findMany()`.
- Guest↔User linking only through `resolveUserForVerifiedContact` / `linkGuestsForContact`.
- Biometric data only in `Face`, `FaceCluster`, `FaceProfile`.

## Review checklist (use in PRs)
- [ ] One reason to change per new module; file < 400 lines
- [ ] New external service behind an interface with a console/fake implementation
- [ ] Server action is thin; logic in `lib/` with tests
- [ ] No app→app or shared→app imports
- [ ] Contracts changed? Updated docs/01 and the matching skill (job payloads, `/embed-selfie`, derivatives JSON)
- [ ] Theme/handler/adapter honours the full contract (Liskov)

## References
- docs/01-architecture.md §2 (provider-agnostic rules), §8 (payments), §11 (repo layout)
- `tdd-workflow` skill
