"""End-to-end tests for hook path resolution across checkouts.

Builds a throwaway repo ("ours") with a linked worktree, plus an unrelated repo, then drives the real
hook scripts through subprocess exactly as Claude Code does (JSON on stdin, exit code back).

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


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=cwd, check=True, capture_output=True,
                   env={**os.environ, **GIT_ENV})


def make_pkg(root: Path) -> None:
    pkg = root / "packages" / "x"
    (pkg / "src").mkdir(parents=True)
    (pkg / "package.json").write_text(json.dumps({"name": "x", "scripts": {"typecheck": "true", "test": "true"}}))
    (pkg / "src" / "tested.ts").write_text("export const a = 1;\n")
    (pkg / "src" / "tested.test.ts").write_text("// test\n")


@pytest.fixture()
def repos(tmp_path: Path):
    ours = tmp_path / "ours"
    ours.mkdir()
    git(ours, "init", "-q", "-b", "main")
    make_pkg(ours)
    git(ours, "add", "-A")
    git(ours, "commit", "-q", "-m", "init")
    wt = tmp_path / "wt"
    git(ours, "worktree", "add", "-q", str(wt))

    other = tmp_path / "other"
    other.mkdir()
    git(other, "init", "-q", "-b", "main")
    make_pkg(other)
    return {"ours": ours, "wt": wt, "other": other, "tmp": tmp_path}


def hook(name: str, payload: dict, project: Path, extra_env: dict | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(project), "HOOK_FAST": "1", **(extra_env or {})}
    return subprocess.run([sys.executable, str(HOOKS / name)], input=json.dumps(payload), capture_output=True,
                          text=True, env=env, timeout=60)


def edit(path: Path) -> dict:
    return {"tool_name": "Edit", "session_id": "pytest", "tool_input": {"file_path": str(path), "new_string": "x"}}


def test_gate_blocks_untested_source_in_a_worktree(repos):
    r = hook("tdd_gate.py", edit(repos["wt"] / "packages/x/src/new.ts"), repos["ours"])
    assert r.returncode == 2, r.stderr
    assert "packages/x/src/new.ts has no test" in r.stderr


def test_gate_allows_tested_source_in_a_worktree(repos):
    r = hook("tdd_gate.py", edit(repos["wt"] / "packages/x/src/tested.ts"), repos["ours"])
    assert r.returncode == 0, r.stderr


def test_gate_still_applies_in_the_main_tree(repos):
    assert hook("tdd_gate.py", edit(repos["ours"] / "packages/x/src/new.ts"), repos["ours"]).returncode == 2
    assert hook("tdd_gate.py", edit(repos["ours"] / "packages/x/src/tested.ts"), repos["ours"]).returncode == 0


def test_gate_ignores_files_outside_any_repo(repos):
    loose = repos["tmp"] / "loose" / "packages/x/src/new.ts"
    assert hook("tdd_gate.py", edit(loose), repos["ours"]).returncode == 0


def test_gate_ignores_an_unrelated_repository(repos):
    r = hook("tdd_gate.py", edit(repos["other"] / "packages/x/src/new.ts"), repos["ours"])
    assert r.returncode == 0, f"unrelated repo must pass through, got: {r.stderr}"


def _stub_pnpm(tmp: Path) -> tuple[Path, Path]:
    bin_dir = tmp / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp / "pnpm.log"
    stub = bin_dir / "pnpm"
    stub.write_text(f'#!/bin/sh\necho "$PWD $*" >> "{log}"\nexit 0\n')
    stub.chmod(0o755)
    return bin_dir, log


def _ledger(project: Path, *files: Path) -> None:
    d = project / ".claude" / ".touched"
    d.mkdir(parents=True, exist_ok=True)
    (d / "pytest").write_text("".join(f"{f}\n" for f in files))


def test_stop_verify_checks_the_worktree_package_it_was_told_about(repos):
    bin_dir, log = _stub_pnpm(repos["tmp"])
    (repos["wt"] / "node_modules").mkdir()
    _ledger(repos["ours"], repos["wt"] / "packages/x/src/tested.ts")
    r = hook("stop_verify.py", {"session_id": "pytest", "stop_hook_active": False}, repos["ours"],
             {"PATH": f"{bin_dir}:{os.environ['PATH']}"})
    assert r.returncode == 0
    calls = log.read_text().splitlines()
    wt_pkg = str((repos["wt"] / "packages/x").resolve())
    assert any(c.startswith(wt_pkg) and "typecheck" in c for c in calls), calls
    assert not any(c.startswith(str(repos["ours"].resolve())) for c in calls), calls


def test_stop_verify_skips_an_unbootstrapped_worktree_with_a_note(repos):
    bin_dir, log = _stub_pnpm(repos["tmp"])
    _ledger(repos["ours"], repos["wt"] / "packages/x/src/tested.ts")
    r = hook("stop_verify.py", {"session_id": "pytest", "stop_hook_active": False}, repos["ours"],
             {"PATH": f"{bin_dir}:{os.environ['PATH']}"})
    assert r.returncode == 0
    assert "not bootstrapped" in r.stderr and "pnpm install" in r.stderr
    assert not log.exists(), "no checks should run before pnpm install"
