---
id: WRK-018
title: Tag derivative and zip objects hub-class=derived so lifecycle rules can expire their old versions
labels: [type:chore, area:worker, priority:p2, size:S, agent-ready]
milestone: Phase 1 — MVP
depends_on: [DOC-003]
epic: EPIC-GALLERY
---

## Context
docs/ops/backups.md §5 (DOC-003) versions the whole bucket. It keeps noncurrent versions 90 days, which protects originals. Derivatives (`…/d/…`) and zips (`…/zip/…`) can be rebuilt, so their old versions should expire after 7 days. Lifecycle filters only match a key prefix or tags, and the class sits mid-key (`s/{studioId}/e/{eventId}/d/…`). So the `derived-noncurrent-7d` rule matches on the object tag `hub-class=derived`. Nothing writes that tag yet, so derived noncurrent versions live 90 days, which costs storage.

## Scope
- `workers/media/hub_worker/storage.py`:
  - `put_bytes` and `put_file` take an optional `tags: Mapping[str, str]`, sent as `Tagging` (`put_object`) or `ExtraArgs["Tagging"]` (`upload_file`), URL-encoded.
  - A constant `DERIVED_TAGS = {"hub-class": "derived"}`.
- Pass `DERIVED_TAGS` wherever derivatives (`process_photo`, plus key rotation from WRK-005 if merged) and zip parts (`build_zip`) are written.
- Originals and `site/` objects stay untagged.
- pytest against RustFS (skip when unreachable): after a derivative write, `get_object_tagging` returns `hub-class=derived`. An original put through the same helper without tags has none.

## Out of scope
- Re-tagging objects already in the bucket. Before launch there are none; if there are, add a one-off script.
- Changing the lifecycle JSON. It is already in docs/ops/backups.md.

## Acceptance criteria
- [ ] New derivative and zip objects carry the tag `hub-class=derived` (pytest against RustFS).
- [ ] Originals and site assets are written without that tag (pytest).

## Files
- `workers/media/hub_worker/storage.py`, `workers/media/hub_worker/handlers/{process_photo.py,build_zip.py}`, `workers/media/tests/test_storage.py` (new or extended)

## Verification
```bash
cd workers/media && .venv/bin/pytest -q tests/test_storage.py
```

## Notes for agents
Id history: this ticket was drafted as WRK-017 in PR #135, but WRK-017 ("Carry eventId/studioId in worker-enqueued job payloads", PR #136) took that id first. **Dependency:** PR #136 (merged as 558b188, which also carried the WRK-017 eventId payload change) touched the worker's `enqueue` call sites and job payloads; branch from a `dev` that includes it, since the `process_photo.py` and `build_zip.py` edits here are in neighbouring lines.

Scope note recorded from the PR #135 review: the `derived-noncurrent-7d` lifecycle rule in docs/ops/backups.md deviates from the ticket text ("expire `d/` and `zip/` noncurrent after 7 d"). Lifecycle filters match a key prefix or tags only, and the key class sits mid-key (`s/{studioId}/e/{eventId}/d/…`), so the rule matches the tag `hub-class=derived`. Until this ticket lands the rule matches nothing and derived objects keep noncurrent versions for 90 days.

Check that RustFS accepts `Tagging` on put. If it doesn't, keep the code path, and make the test skip with a clear reason when the local server rejects tags. Real S3 supports it.
