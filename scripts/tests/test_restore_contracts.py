"""Drift checks for the restore contract (DOC-003). Text only: no Docker, no database.

The restore runbook and replay copy the worker's job upsert and depend on AuditLog action names
written by the apps. Nothing else ties them together, so these tests do: change one side and the
other must follow.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JOBS_PY = ROOT / "workers" / "media" / "hub_worker" / "jobs.py"
DB_INDEX_TS = ROOT / "packages" / "db" / "src" / "index.ts"
RUNBOOK = ROOT / "docs" / "ops" / "runbook-restore.md"
REPLAY_SQL = ROOT / "docs" / "ops" / "replay-after-restore.sql"
EXPORT_SQL = ROOT / "docs" / "ops" / "replay-export.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "restore-drill.yml"
OBS_SKILL = ROOT / ".claude" / "skills" / "observability-logging" / "SKILL.md"
LEG_008 = ROOT / "backlog" / "legal" / "LEG-008-deletion-ledger-outside-db.md"

UPSERT = re.compile(r'ON CONFLICT \("dedupeKey"\) DO UPDATE SET(.*?)WHERE "Job"\.status <> \'RUNNING\'::"JobStatus"', re.S)


def _upserts(text: str) -> list[str]:
    return [re.sub(r"\s+", " ", m).strip() for m in UPSERT.findall(text)]


def _exported_actions() -> list[str]:
    in_list = re.search(r"action IN \((.*?)\)", EXPORT_SQL.read_text(), re.S)
    assert in_list, "replay-export.sql must filter on an explicit action list"
    return re.findall(r"'([a-z_.]+)'", in_list.group(1))


def test_every_copy_of_the_job_upsert_matches_the_worker() -> None:
    worker = _upserts(JOBS_PY.read_text())
    assert len(worker) == 1, "jobs.enqueue has exactly one dedupe upsert"
    copies = _upserts(REPLAY_SQL.read_text()) + _upserts(RUNBOOK.read_text())
    assert len(copies) >= 2, "the replay and the runbook's due-purge block both carry a copy"
    for copy in copies:
        assert copy == worker[0]


def test_every_replayed_audit_action_is_still_written_by_the_code() -> None:
    sources = [
        p for base in (ROOT / "apps", ROOT / "workers")
        for p in base.rglob("*")
        if p.suffix in {".ts", ".tsx", ".py"} and "node_modules" not in p.parts
        and not re.search(r"(\.test\.|/tests?/|/test_)", str(p))
    ]
    code = "\n".join(p.read_text(errors="ignore") for p in sources)
    actions = _exported_actions()
    assert {"faceindex.purge", "faceindex.purge.request", "event.facesearch.disable",
            "event.facesearch.enable", "photo.delete"} <= set(actions)
    for action in actions:
        assert re.search(rf"""["'`]{re.escape(action)}["'`]""", code), f"no writer under apps/ or workers/ emits {action!r}"


def test_the_replay_only_acts_on_actions_the_export_selects() -> None:
    used = set(re.findall(r"'([a-z]+\.[a-z.]+)'", REPLAY_SQL.read_text()))
    assert used <= set(_exported_actions())


def test_the_coupled_sources_point_at_the_restore_contract() -> None:
    for path in (JOBS_PY, DB_INDEX_TS):
        assert "replay-after-restore.sql" in path.read_text(), f"{path.name} must say its upsert is copied there"
    skill = OBS_SKILL.read_text()
    assert "replay-export.sql" in skill and "restore contract" in skill.lower()


def test_docs_only_changes_still_run_the_restore_drill_workflow() -> None:
    paths = WORKFLOW.read_text()
    for needed in ("docs/ops/**", "workers/media/hub_worker/jobs.py"):
        assert needed in paths, needed


def test_leg_008_no_longer_claims_event_purges_are_recomputable() -> None:
    text = LEG_008.read_text()
    assert "recomputable from `faceIndexPurgeAt`" not in text
    for action in ("faceindex.purge.request", "event.facesearch.disable", "photo.delete"):
        assert action in text, action
