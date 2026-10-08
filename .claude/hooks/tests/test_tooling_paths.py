"""scripts/** and docs/adr/** sit outside is_source (no TDD gate), but their tests (@hub/scripts) must
still run before a session ends: post_edit_check records such edits in the touched ledger and
stop_verify runs the `scripts` package tests when either path changed.

Run: workers/media/.venv/bin/python -m pytest -q .claude/hooks/tests
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOKS = Path(__file__).resolve().parents[1]
GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    (root / "docs" / "adr").mkdir(parents=True)
    (root / "node_modules").mkdir()
    (root / "scripts" / "package.json").write_text(json.dumps({"name": "@hub/scripts", "scripts": {"test": "vitest run"}}))
    (root / "scripts" / "adr-new.mjs").write_text("export {};\n")
    (root / "docs" / "adr" / "0001-x.md").write_text("# ADR-0001: x\n")
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=root, check=True, capture_output=True, env={**os.environ, **GIT_ENV})
    return root


def _stub_pnpm(tmp: Path) -> tuple[Path, Path]:
    bin_dir, log = tmp / "bin", tmp / "pnpm.log"
    bin_dir.mkdir()
    stub = bin_dir / "pnpm"
    stub.write_text(f'#!/bin/sh\necho "$PWD $*" >> "{log}"\nexit 0\n')
    stub.chmod(0o755)
    return bin_dir, log


def _run(name: str, payload: dict, project: Path, bin_dir: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(project), "HOOK_FAST": "1", "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    return subprocess.run([sys.executable, str(HOOKS / name)], input=json.dumps(payload), capture_output=True, text=True, env=env, timeout=60)


def _edit(path: Path) -> dict:
    return {"tool_name": "Edit", "session_id": "pytest", "tool_input": {"file_path": str(path), "new_string": "x"}}


def _ledger(project: Path) -> list[str]:
    f = project / ".claude" / ".touched" / "pytest"
    return f.read_text().splitlines() if f.exists() else []


@pytest.mark.parametrize("rel", ["scripts/adr-new.mjs", "docs/adr/0001-x.md"])
def test_post_edit_records_tooling_edits_without_running_checks(repo, tmp_path, rel):
    bin_dir, log = _stub_pnpm(tmp_path)
    r = _run("post_edit_check.py", _edit(repo / rel), repo, bin_dir)
    assert r.returncode == 0, r.stderr
    assert str((repo / rel).resolve()) in _ledger(repo)
    assert not log.exists(), "post-edit stays fast: tests run at Stop"


@pytest.mark.parametrize("rel", ["scripts/adr-new.mjs", "docs/adr/0001-x.md"])
def test_stop_verify_runs_the_scripts_tests_when_tooling_changed(repo, tmp_path, rel):
    bin_dir, log = _stub_pnpm(tmp_path)
    ledger = repo / ".claude" / ".touched"
    ledger.mkdir(parents=True)
    (ledger / "pytest").write_text(f"{(repo / rel).resolve()}\n")
    r = _run("stop_verify.py", {"session_id": "pytest", "stop_hook_active": False}, repo, bin_dir)
    assert r.returncode == 0, r.stderr
    calls = log.read_text().splitlines()
    assert any(c.startswith(str((repo / "scripts").resolve())) and c.endswith("run test") for c in calls), calls


def test_stop_verify_ignores_other_docs(repo, tmp_path):
    bin_dir, log = _stub_pnpm(tmp_path)
    other = repo / "docs" / "01-architecture.md"
    other.write_text("# x\n")
    ledger = repo / ".claude" / ".touched"
    ledger.mkdir(parents=True)
    (ledger / "pytest").write_text(f"{other.resolve()}\n")
    r = _run("stop_verify.py", {"session_id": "pytest", "stop_hook_active": False}, repo, bin_dir)
    assert r.returncode == 0, r.stderr
    assert not log.exists()
