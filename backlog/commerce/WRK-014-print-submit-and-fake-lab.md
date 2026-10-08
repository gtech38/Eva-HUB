---
id: WRK-014
title: PRINT_SUBMIT with a PrintLab adapter interface and a fake lab for local
labels: [type:feature, area:worker, area:shared, priority:p2, size:M, agent-ready]
milestone: Phase 2 — Commerce, messaging, polish
depends_on: [WEB-024]
epic: EPIC-COMMERCE
---

## Context
`handlers/print_submit.py` logs and succeeds. docs/01 §2 lists `PrintLab` as a TypeScript adapter interface; the job runs in the Python worker. Keep the lab HTTP call in the worker (it needs presigned originals and retries) with the interface defined in both languages, and a fake lab for local/e2e so no real lab account is needed until WRK-015-style adapters arrive.

## Scope
- Python `hub_worker/labs/{base,fake}.py`: `class PrintLab(Protocol): submit(order) -> {externalId}; status(externalId) -> {status, trackingUrl}`; `FakeLab` writes the submitted order JSON to the bucket under `s/{studio}/e/{event}/lab/{orderId}.json` and returns `externalId = fake-<orderId>`; `PRINT_LAB=fake|whcc` setting (whcc raises NotImplemented with a pointer to the adapter ticket).
- `print_submit.py`: load `Order(PAID)` + items + products + photos; build line items (`labSku`, qty, crop, 5-minute presigned GET of the original); call `lab.submit`; create `PrintFulfillment(SUBMITTED, lab, externalId)`; audit `print.submit`; `Requeue` if the order is not PAID yet (webhook race); idempotent via existing fulfillment.
- Inbound lab webhook route `apps/web/src/app/api/labs/[lab]/webhook/route.ts` (shared-secret header) updating `PrintFulfillment.status/trackingUrl`; the fake lab has an admin button "Simulate shipped" on the order page that calls the same code path.
- TS mirror `packages/shared/src/printlab.ts` interface + status enum for the admin UI.
- pytest: submit creates the fulfilment and the fake JSON object; second run is a no-op; unpaid order requeues.

## Out of scope
- Real lab adapter (follow-up `WRK-015 WHCC adapter`, needs INF-009 credentials). Order emails (ADM-021).

## Acceptance criteria
- [ ] PAID order → one `PrintFulfillment(SUBMITTED)` and one JSON object in the bucket; rerun adds nothing.
- [ ] PENDING order → job requeued, no fulfilment.
- [ ] Webhook with wrong secret → 401; correct → status updated and audited.

## Files
- `workers/media/hub_worker/handlers/print_submit.py`, `workers/media/hub_worker/labs/{__init__,base,fake}.py` (new), `workers/media/hub_worker/config.py`, `workers/media/tests/test_print_submit.py` (new)
- `packages/shared/src/printlab.ts` (new), `apps/web/src/app/api/labs/[lab]/webhook/route.ts` (new), `apps/admin/src/app/studios/[studioId]/events/[eventId]/orders/page.tsx` (ADM-021 creates; add button here if it exists)

## Verification
```bash
cd workers/media && make test -- -k print_submit
pnpm --filter @hub/web test
```

## Notes for agents
First failing test: PAID → fulfilment + object. Presigned URLs for the lab must be short-lived and audited as `photo.download` with `data.lab = true`.
