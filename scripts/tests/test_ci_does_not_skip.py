"""Under CI the drill tests must fail, not skip, when the stack they need is missing.

A green CI run that skipped every drill test proves nothing, so test_backup_restore_drill.py
raises at import time when $CI is set and Docker / Postgres are unavailable.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

DRILL_TESTS = Path(__file__).with_name("test_backup_restore_drill.py")


def _run_drill_tests(**env: str) -> subprocess.CompletedProcess[str]:
    full_env = {k: v for k, v in os.environ.items() if k not in {"CI", "DATABASE_URL"}}
    full_env.update(env)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(DRILL_TESTS)],
        env=full_env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_unreachable_database_fails_the_drill_tests_when_ci_is_set() -> None:
    proc = _run_drill_tests(CI="true", DATABASE_URL="postgresql://hub:hub@127.0.0.1:1/hub")

    assert proc.returncode != 0, proc.stdout + proc.stderr
    assert "cannot run in CI" in proc.stdout + proc.stderr
    assert "skipped" not in proc.stdout.lower()


def test_unreachable_database_only_skips_outside_ci() -> None:
    proc = _run_drill_tests(DATABASE_URL="postgresql://hub:hub@127.0.0.1:1/hub")

    assert proc.returncode == 5, proc.stdout + proc.stderr  # pytest: nothing ran (module skipped)
    assert "skipped" in proc.stdout.lower()
