"""post_edit_check.py picks the test runner from the edited package's own devDependencies.

vitest is the only TypeScript runner (INF-001). A package that has a test but does not list vitest
must be reported as a problem, not silently run under another runner.

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


def _repo(tmp: Path, dev_deps: dict[str, str]) -> Path:
    root = tmp / "repo"
    pkg = root / "packages" / "x"
    (pkg / "src").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=root, check=True, capture_output=True)
    (root / "node_modules").mkdir()
    (pkg / "package.json").write_text(json.dumps({"name": "x", "devDependencies": dev_deps}))
    (pkg / "src" / "tested.ts").write_text("export const a = 1;\n")
    (pkg / "src" / "tested.test.ts").write_text('import { expect, it } from "vitest";\nit("a", () => expect(1).toBe(1));\n')
    return root


def _stub_bin(tmp: Path) -> tuple[Path, Path]:
    """`pnpm` and `node` stubs that log their argv and succeed, so we can see what the hook ran."""
    bin_dir, log = tmp / "bin", tmp / "calls.log"
    bin_dir.mkdir()
    for name in ("pnpm", "node"):
        stub = bin_dir / name
        stub.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\nexit 0\n')
        stub.chmod(0o755)
    return bin_dir, log


def _edit(root: Path, tmp: Path) -> tuple[subprocess.CompletedProcess, list[str]]:
    bin_dir, log = _stub_bin(tmp)
    payload = {"tool_name": "Edit", "session_id": "pytest",
               "tool_input": {"file_path": str(root / "packages/x/src/tested.ts"), "new_string": "x"}}
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(root), "HOOK_FAST": "1", "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    r = subprocess.run([sys.executable, str(HOOKS / "post_edit_check.py")], input=json.dumps(payload),
                       capture_output=True, text=True, env=env, timeout=60)
    return r, (log.read_text().splitlines() if log.exists() else [])


@pytest.fixture()
def tmp(tmp_path: Path) -> Path:
    return tmp_path


def test_runs_the_sibling_test_with_vitest_when_the_package_lists_it(tmp):
    r, calls = _edit(_repo(tmp, {"vitest": "^4.1.11"}), tmp)
    assert r.returncode == 0, r.stderr
    assert len(calls) == 1 and calls[0].startswith("pnpm exec vitest run ") and calls[0].endswith("tested.test.ts --reporter=dot"), calls


def test_a_package_without_vitest_is_a_problem_and_no_other_runner_is_used(tmp):
    r, calls = _edit(_repo(tmp, {"tsx": "^4.19.2"}), tmp)
    assert r.returncode == 2
    assert "packages/x does not list `vitest` in devDependencies" in r.stderr, r.stderr
    assert "pnpm --filter x add -D vitest" in r.stderr, r.stderr
    assert calls == [], f"no test runner should be invoked: {calls}"
