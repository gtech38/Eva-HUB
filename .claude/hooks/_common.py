"""Shared helpers for Claude Code hooks in this repo.

Hooks receive a JSON payload on stdin (tool_name, tool_input, ...). They talk back by
exit code: 0 = allow/quiet, 2 = block (PreToolUse) or "show stderr to Claude" (PostToolUse).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])

TS_EXT = {".ts", ".tsx", ".mts"}
PY_EXT = {".py"}

# Files that never need a unit test of their own (covered by e2e/visual tests or are config/wiring).
EXEMPT_BASENAMES = {
    "page.tsx", "layout.tsx", "loading.tsx", "error.tsx", "not-found.tsx", "template.tsx",
    "global-error.tsx", "default.tsx", "opengraph-image.tsx",
    "types.ts", "constants.ts", "env.d.ts", "next-env.d.ts", "middleware.ts",
    "__init__.py", "__main__.py", "conftest.py", "config.py",
}
EXEMPT_DIR_PARTS = {
    "node_modules", ".next", "dist", "migrations", "prisma", "e2e", "scripts",
    "themes", "components", "styles", "public", ".claude", "docs", "backlog", "infra", "models",
}
TEST_MARKERS = (".test.", ".spec.", "/tests/", "/__tests__/", "/e2e/", "/test_")


def read_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def file_from_payload(p: dict) -> Path | None:
    fp = (p.get("tool_input") or {}).get("file_path")
    if not fp:
        return None
    path = Path(fp)
    return path if path.is_absolute() else ROOT / path


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve()))
    except ValueError:
        return str(path)


def is_source(path: Path) -> bool:
    r = rel(path)
    if not (r.startswith("apps/") or r.startswith("packages/") or r.startswith("workers/")):
        return False
    if path.suffix not in TS_EXT | PY_EXT:
        return False
    if path.name.endswith(".d.ts") or path.name in EXEMPT_BASENAMES:
        return False
    parts = set(Path(r).parts)
    if parts & EXEMPT_DIR_PARTS:
        return False
    return True


def is_test(path: Path) -> bool:
    r = "/" + rel(path)
    return any(m in r for m in TEST_MARKERS) or path.name.startswith("test_")


def test_candidates(path: Path) -> list[Path]:
    """Where we expect the test for `path` to live."""
    if path.suffix in PY_EXT:
        # workers/media/hub_worker/handlers/foo.py -> workers/media/tests/test_foo.py (or test_handlers_foo.py)
        pkg_root = next((p for p in path.parents if (p / "pyproject.toml").exists()), None)
        if not pkg_root:
            return []
        tests = pkg_root / "tests"
        stem = path.stem
        rel_parts = path.relative_to(pkg_root).with_suffix("").parts[1:]  # drop package dir
        joined = "_".join(rel_parts)
        return [tests / f"test_{stem}.py", tests / f"test_{joined}.py", *tests.glob(f"**/test_{stem}.py")]
    stem = path.name[: -len(path.suffix)]
    d = path.parent
    out = []
    for ext in (".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"):
        out.append(d / f"{stem}{ext}")
        out.append(d / "__tests__" / f"{stem}{ext}")
    # package-level tests/ dir
    pkg_root = next((p for p in path.parents if (p / "package.json").exists()), None)
    if pkg_root:
        for ext in (".test.ts", ".test.tsx"):
            out.extend(pkg_root.glob(f"tests/**/{stem}{ext}"))
            out.extend(pkg_root.glob(f"src/**/__tests__/{stem}{ext}"))
    return out


def existing_test(path: Path) -> Path | None:
    for c in test_candidates(path):
        if c.exists():
            return c
    return None


def package_root(path: Path) -> Path | None:
    for p in path.parents:
        if (p / "package.json").exists() or (p / "pyproject.toml").exists():
            return p
    return None


def run(cmd: list[str], cwd: Path, timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s: {' '.join(cmd)}"
    except FileNotFoundError as e:
        return 127, str(e)


def tail(s: str, n: int = 40) -> str:
    lines = s.splitlines()
    return "\n".join(lines[-n:])


def exempt_marker(p: dict) -> str | None:
    """`// tdd-exempt: reason` or `# tdd-exempt: reason` in the content being written."""
    ti = p.get("tool_input") or {}
    text = ti.get("content") or ti.get("new_string") or ""
    m = re.search(r"tdd-exempt:\s*(.+)", text)
    return m.group(1).strip() if m else None
