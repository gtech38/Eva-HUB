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

CI_YML = ROOT / ".github" / "workflows" / "ci.yml"

# The whole dedupe upsert: the INSERT column list, and everything from ON CONFLICT through the
# RUNNING guard. The row source in between (VALUES with parameters vs SELECT) legitimately differs.
UPSERT = re.compile(
    r'INSERT INTO "Job"\s*\(([^)]*)\)'
    r"(?:(?!INSERT INTO).)*?"
    r'(ON CONFLICT \("dedupeKey"\) DO UPDATE SET.*?WHERE "Job"\.status <> \'RUNNING\'::"JobStatus")',
    re.S,
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _upserts(text: str) -> list[tuple[str, str]]:
    return [(_norm(cols), _norm(clause)) for cols, clause in UPSERT.findall(text)]


def _exported_actions() -> list[str]:
    in_list = re.search(r"action IN \((.*?)\)", EXPORT_SQL.read_text(), re.S)
    assert in_list, "replay-export.sql must filter on an explicit action list"
    return re.findall(r"'([a-z_.]+)'", in_list.group(1))


def test_every_copy_of_the_job_upsert_matches_the_worker() -> None:
    worker = _upserts(JOBS_PY.read_text())
    assert len(worker) == 1, "jobs.enqueue has exactly one dedupe upsert"
    # exact counts: a copy that is added, dropped or half-edited (so the regex misses it) fails here
    expected = {REPLAY_SQL: 1, RUNBOOK: 2}  # runbook: 6c due purges, step 7 re-purge after verification
    for path, count in expected.items():
        copies = _upserts(path.read_text())
        assert len(copies) == count, f"{path.name}: {len(copies)} upsert copies, expected {count}"
        for cols, clause in copies:
            assert cols == worker[0][0], f"{path.name}: INSERT column list differs from jobs.py"
            assert clause == worker[0][1], f"{path.name}: ON CONFLICT … WHERE clause differs from jobs.py"


WRITER_SHAPE = {
    # action: fields the replay reads from the AuditLog row, which the writer must set
    "faceindex.purge": ("eventId",),
    "faceindex.purge.request": ("eventId",),
    "event.facesearch.disable": ("eventId",),
    "event.facesearch.enable": ("eventId",),
    "photo.delete": ("eventId", "target"),
}


def test_replayed_actions_are_written_with_the_fields_the_replay_reads() -> None:
    writers = {
        "faceindex.purge": ROOT / "workers" / "media" / "hub_worker" / "handlers" / "purge_face_index.py",
        "faceindex.purge.request": ROOT / "apps" / "admin" / "src" / "app" / "studios" / "[studioId]" / "events" / "[eventId]" / "actions.ts",
        "event.facesearch.disable": ROOT / "apps" / "admin" / "src" / "app" / "studios" / "[studioId]" / "events" / "[eventId]" / "actions.ts",
        "event.facesearch.enable": ROOT / "apps" / "admin" / "src" / "app" / "studios" / "[studioId]" / "events" / "[eventId]" / "actions.ts",
        "photo.delete": ROOT / "apps" / "admin" / "src" / "app" / "studios" / "[studioId]" / "events" / "[eventId]" / "gallery" / "actions.ts",
    }
    assert set(writers) == set(WRITER_SHAPE) == set(_exported_actions())
    for action, path in writers.items():
        text = path.read_text()
        # the statement that writes the row: the audit({...}) call or the INSERT around the literal
        at = text.index(f"'{action}'") if f"'{action}'" in text else text.index(f'"{action}"')
        start = max(text.rfind("audit(", 0, at), text.rfind('INSERT INTO "AuditLog"', 0, at))
        assert start != -1, f"{action}: no audit( call or AuditLog INSERT before the literal in {path.name}"
        end = text.find(";", at) if path.suffix == ".ts" else text.find(")\n", at + 200)
        statement = text[start:end if end != -1 else at + 400]
        for field in WRITER_SHAPE[action]:
            assert re.search(rf'\b"?{field}"?\b', statement), f"{action}: writer in {path.name} does not set {field}"
        if action == "photo.delete":
            assert re.search(r"target:\s*id\b", statement), "photo.delete must audit target = the photo id"


def test_ci_runs_the_contract_tests_on_every_pr() -> None:
    # the drill workflow is path-filtered; a rename in apps/ or workers/ must still be caught
    assert "scripts/tests/test_restore_contracts.py" in CI_YML.read_text()


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
