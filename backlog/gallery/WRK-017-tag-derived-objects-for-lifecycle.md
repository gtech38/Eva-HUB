---
id: WRK-017
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
Check that RustFS accepts `Tagging` on put. If it doesn't, keep the code path, and make the test skip with a clear reason when the local server rejects tags. Real S3 supports it.
