"""Shared helpers for Claude Code hooks in this repo.

Hooks receive a JSON payload on stdin (tool_name, tool_input, ...). They talk back by
exit code: 0 = allow/quiet, 2 = block (PreToolUse) or "show stderr to Claude" (PostToolUse).
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
from functools import lru_cache
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])

TS_EXT = {".ts", ".tsx", ".mts"}
PY_EXT = {".py"}
SRC_EXT = TS_EXT | PY_EXT

# Files that never need a unit test of their own (covered by e2e/visual tests or are config/wiring).
EXEMPT_BASENAMES = {
    "page.tsx", "layout.tsx", "loading.tsx", "error.tsx", "not-found.tsx", "template.tsx",
    "global-error.tsx", "default.tsx", "opengraph-image.tsx",
    "types.ts", "constants.ts", "env.d.ts", "next-env.d.ts", "middleware.ts",
    "next.config.ts", "next.config.js", "next.config.mjs",
    "tailwind.config.ts", "tailwind.config.js",
    "postcss.config.js", "postcss.config.mjs", "postcss.config.cjs",
    "vitest.config.ts", "vitest.config.mts", "playwright.config.ts",
    "__init__.py", "__main__.py", "conftest.py", "config.py",
}
# Any `<tool>.config.<ext>` is tool configuration, not behaviour.
CONFIG_FILE_RE = re.compile(r"^[\w.-]+\.config\.(ts|mts|cts|js|mjs|cjs)$")
EXEMPT_DIR_PARTS = {
    "node_modules", ".next", "dist", "migrations", "prisma", "e2e", "scripts",
    "themes", "components", "styles", "public", ".claude", "docs", "backlog", "infra", "models",
}
TEST_MARKERS = (".test.", ".spec.", "/tests/", "/__tests__/", "/e2e/", "/test_")
EXEMPT_RE = re.compile(r"tdd-exempt:\s*(.+)")
EXEMPT_SCAN_BYTES = 4096

TOUCHED_DIR = ROOT / ".claude" / ".touched"


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


@lru_cache(maxsize=64)
def _git_common_dir(checkout: Path) -> Path | None:
    """Absolute git common dir of a checkout; equal for the main tree and all its linked worktrees."""
    try:
        r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                           cwd=checkout, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return Path(r.stdout.strip()).resolve() if r.returncode == 0 and r.stdout.strip() else None


def main_tree() -> Path:
    """The main checkout of this repository, even when the session itself runs in a worktree."""
    common = _git_common_dir(ROOT.resolve())
    return common.parent if common else ROOT.resolve()


def repo_root(path: Path) -> Path | None:
    """The checkout of *this* repository that owns `path`: the main tree or a linked worktree.

    Agents work in worktrees outside CLAUDE_PROJECT_DIR; resolving against the owning checkout keeps the
    TDD gate and post-edit checks active there. A checkout of any *other* repository returns None, so
    its files pass through untouched (they are not our source).
    """
    p = path.resolve()
    ours = _git_common_dir(ROOT.resolve())
    for parent in [p, *p.parents]:
        if (parent / ".git").exists():
            return parent if ours is not None and _git_common_dir(parent) == ours else None
    return None


def rel(path: Path) -> str:
    """Path relative to the owning checkout of this repo; absolute (i.e. foreign) otherwise."""
    root = repo_root(path)
    if root is None:
        return str(path.resolve())
    try:
        return str(path.resolve().relative_to(root))
    except ValueError:
        return str(path.resolve())


def venv_python(pkg: Path) -> Path | None:
    """Python for a package: its own .venv, else the main tree's (worktrees have none)."""
    root = repo_root(pkg)
    rel_pkg = pkg.resolve().relative_to(root) if root else None
    candidates = [pkg / ".venv/bin/python"] + ([main_tree() / rel_pkg / ".venv/bin/python"] if rel_pkg else [])
    return next((c for c in candidates if c.exists()), None)


def bootstrap_problem(path: Path) -> str | None:
    """Why checks can't run in this checkout yet (fresh worktree), or None when it is ready."""
    root = repo_root(path)
    if root is None or root == main_tree():
        return None
    if not (root / "node_modules").exists():
        return f"worktree {root} is not bootstrapped: run `pnpm install` there (checks skipped until then)"
    return None


def checkout_env(path: Path) -> dict[str, str] | None:
    """Subprocess env for a checkout with no .env of its own: the main tree's .env under os.environ."""
    root = repo_root(path)
    if root is None or (root / ".env").exists():
        return None
    env_file = main_tree() / ".env"
    if not env_file.exists():
        return None
    env = dict(os.environ)
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.split(" #", 1)[0].strip().strip('"').strip("'")
        env.setdefault(k.strip(), v)
    return env


def is_source(path: Path) -> bool:
    r = rel(path)
    if not (r.startswith("apps/") or r.startswith("packages/") or r.startswith("workers/")):
        return False
    if path.suffix not in SRC_EXT:
        return False
    if path.name.endswith(".d.ts") or path.name in EXEMPT_BASENAMES or CONFIG_FILE_RE.match(path.name):
        return False
    parts = set(Path(r).parts)
    if parts & EXEMPT_DIR_PARTS:
        return False
    return True


def is_test(path: Path) -> bool:
    r = "/" + rel(path)
    return any(m in r for m in TEST_MARKERS) or path.name.startswith("test_")


def test_candidates(path: Path) -> list[Path]:
    """Where we expect the test for `path` to live.

    Every candidate mirrors the source path, so `packages/db/src/index.ts` is only satisfied
    by `packages/db/src/index.test.ts`, `packages/db/src/__tests__/index.test.ts` or
    `packages/db/tests/index.test.ts` -- never by an unrelated `tests/foo/index.test.ts`.
    """
    if path.suffix in PY_EXT:
        # workers/media/hub_worker/handlers/foo.py -> workers/media/tests/test_foo.py (or test_handlers_foo.py)
        pkg_root = next((p for p in path.parents if (p / "pyproject.toml").exists()), None)
        if not pkg_root:
            return []
        tests = pkg_root / "tests"
        stem = path.stem
        rel_parts = path.relative_to(pkg_root).with_suffix("").parts[1:]  # drop package dir
        joined = "_".join(rel_parts)
        mirror_dir = tests.joinpath(*rel_parts[:-1]) if len(rel_parts) > 1 else tests
        return [tests / f"test_{stem}.py", tests / f"test_{joined}.py", mirror_dir / f"test_{stem}.py"]
    stem = path.name[: -len(path.suffix)]
    d = path.parent
    out = []
    for ext in (".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"):
        out.append(d / f"{stem}{ext}")
        out.append(d / "__tests__" / f"{stem}{ext}")
    # package-level tests/ dir, mirroring the path under src/ (or under the package root)
    pkg_root = next((p for p in path.parents if (p / "package.json").exists()), None)
    if pkg_root:
        base = pkg_root / "src" if (pkg_root / "src") in path.parents else pkg_root
        mirror = d.relative_to(base)
        for ext in (".test.ts", ".test.tsx"):
            out.append(pkg_root / "tests" / mirror / f"{stem}{ext}")
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


class Deadline:
    """Shrinking budget shared by every subprocess a hook runs.

    `settings.json` kills the whole hook at its timeout and a killed hook passes silently, so the
    sum of subprocess timeouts must stay under it. Each `run()` gets what is left (floor 5 s).
    """

    def __init__(self, total_s: float):
        self.end = time.monotonic() + total_s

    def remaining(self, floor: int = 5) -> int:
        return max(floor, int(self.end - time.monotonic()))

    def expired(self) -> bool:
        return time.monotonic() >= self.end


def run(cmd: list[str], cwd: Path, timeout: int | Deadline = 120, env: dict[str, str] | None = None) -> tuple[int, str]:
    t = timeout.remaining() if isinstance(timeout, Deadline) else timeout
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=t, env=env)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {t}s: {' '.join(cmd)}"
    except FileNotFoundError as e:
        return 127, str(e)


def tail(s: str, n: int = 40) -> str:
    lines = s.splitlines()
    return "\n".join(lines[-n:])


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    with socket.socket() as s:
        s.settimeout(timeout)
        return s.connect_ex((host, port)) == 0


def exempt_marker(p: dict, path: Path | None = None) -> str | None:
    """`// tdd-exempt: reason` or `# tdd-exempt: reason`, looked for in (in order):

    * the content being written (`Write.content`, `Edit.new_string`, `MultiEdit.edits[].new_string`);
    * the first 4 KB of the file as it exists on disk, so a file marked exempt once stays exempt
      for later edits without re-pasting the marker.
    """
    ti = p.get("tool_input") or {}
    texts = [ti.get("content") or "", ti.get("new_string") or ""]
    texts += [(e or {}).get("new_string") or "" for e in ti.get("edits") or []]
    if path is not None and path.is_file():
        try:
            with path.open("rb") as f:
                texts.append(f.read(EXEMPT_SCAN_BYTES).decode("utf-8", errors="replace"))
        except OSError:
            pass
    for text in texts:
        m = EXEMPT_RE.search(text)
        if m:
            return m.group(1).strip()
    return None


# ── touched-file ledger (PostToolUse writes, Stop reads) ──────────────────────

def touched_ledger(p: dict) -> Path | None:
    sid = p.get("session_id")
    if not sid or not re.fullmatch(r"[\w.-]+", str(sid)):
        return None
    return TOUCHED_DIR / str(sid)


def record_touched(p: dict, path: Path) -> None:
    ledger = touched_ledger(p)
    if not ledger:
        return
    try:
        ledger.parent.mkdir(parents=True, exist_ok=True)
        line = str(path.resolve())  # absolute: the file may live in a worktree, not under ROOT
        existing = ledger.read_text(encoding="utf-8").splitlines() if ledger.exists() else []
        if line not in existing:
            with ledger.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
    except OSError:
        pass


def read_touched(p: dict) -> list[str] | None:
    """Paths edited in this session (absolute; older ledgers may hold ROOT-relative), or None."""
    ledger = touched_ledger(p)
    if not ledger or not ledger.exists():
        return None
    try:
        return [l.strip() for l in ledger.read_text(encoding="utf-8").splitlines() if l.strip()]
    except OSError:
        return None
