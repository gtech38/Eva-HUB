# Architecture Decision Records

An ADR is a short, dated record of one architectural decision: what we chose, why, and what it costs. Tickets and agents cite them (`ADR-0006`) instead of re-deriving the reasoning. The planning docs (`docs/01-04`) say what we intended; ADRs say what the code does today and why.

## When to write one

Write an ADR when a choice:

- is hard to reverse (storage layout, queue technology, tenancy model, auth approach, a biometric model);
- crosses a service or package boundary (a new internal HTTP call, a new dependency direction);
- departs from the planning docs or from a default most readers would expect;
- is something a ticket says to "record as an ADR".

Do not write one for a local refactor, a library bump, or anything a code comment explains in two lines.

## Process

1. Run `node scripts/adr-new.mjs "<title>"`. ADRs are numbered sequentially (`NNNN-slug.md`, four digits, never reused, `0000` is the template). The script copies [0000-template.md](0000-template.md) to the next free number and fills in the number, title and date.
2. Fill in every section. Keep it to one page. Be factual about the code today; put the follow-up tickets in Consequences. The References section must cite at least one repo path that implements the decision (`scripts/adr-docs.test.mjs` checks that every cited path exists).
3. Add a row to the index below.
4. Open it in a pull request against `dev` like any other change. The review is the approval: reviewers comment on the PR, and the author sets the status when it merges.

## Statuses

| Status | Meaning |
|---|---|
| Proposed | Written and under review, or the decision is made but the implementing ticket has not merged. |
| Accepted | Merged and in force. The code matches it. |
| Superseded | Replaced by a later ADR. Keep the file; change the status line to `Superseded by ADR-NNNN` and link it. |

ADRs are not edited to rewrite history. To change a decision, write a new ADR that supersedes the old one. Typo and link fixes are fine.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-postgres-job-queue.md) | Postgres `Job` table with `FOR UPDATE SKIP LOCKED` instead of Redis or SQS | Accepted |
| [0002](0002-s3-api-only-storage.md) | S3 API only for storage; R2 recommended; fixed key layout | Accepted |
| [0003](0003-studio-event-tenancy.md) | Studio to Event tenancy, `studioId` on tenant rows, RLS deferred to Phase 3 | Accepted |
| [0004](0004-face-model-yunet-sface.md) | YuNet and SFace (OpenCV Zoo) instead of InsightFace weights | Accepted |
| [0005](0005-rustfs-local-s3.md) | RustFS as the local S3 server because MinIO images were withdrawn | Accepted |
| [0006](0006-self-built-auth.md) | Self-built session and magic-link auth instead of Better Auth for the POC | Accepted |
| [0007](0007-separate-admin-app.md) | `apps/admin` is a separate Next.js app from `apps/web` | Accepted |
| [0008](0008-worker-to-admin-message-sending.md) | Worker sends messages through an internal admin HTTP endpoint | Proposed |
