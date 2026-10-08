#!/usr/bin/env python3
"""Stop: before Claude ends its turn, verify the packages it touched.

Which files count as "touched": the ledger `.claude/.touched/<session_id>` that
post_edit_check.py appends to on every source edit in this session. Only if that ledger is
absent (e.g. hooks were added mid-session) do we fall back to `git status`, which also picks up
pre-existing WIP.

Runs typecheck + tests for every workspace package with touched source (and pytest for the
worker). `packages/db` tests need Postgres, so they are skipped with a note when :5433 is closed.
If anything fails, the stop is blocked once with the failure output so Claude finishes the job
instead of handing back red code. `stop_hook_active` prevents loops.

All subprocesses share one shrinking deadline (TOTAL_BUDGET_S) that stays under the 600 s hook
timeout in settings.json, so a slow run surfaces as a "timed out" failure instead of the harness
killing the hook and silently passing.
"""
import json
import sys
from pathlib import Path

from _common import ROOT, SRC_EXT, Deadline, bootstrap_problem, checkout_env, port_open, read_payload, read_touched, rel, repo_root, run, tail, venv_python

TOTAL_BUDGET_S = 540
POSTGRES_PORT = 5433
VERIFY_EXT = tuple(SRC_EXT | {".prisma"})

p = read_payload()
if p.get("stop_hook_active"):
    sys.exit(0)

deadline = Deadline(TOTAL_BUDGET_S)

changed = read_touched(p)
if changed is None:
    code, out = run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT, timeout=20)
    changed = [l[3:].strip().strip('"') for l in out.splitlines() if l.strip()]
# `git status` (fallback when there is no ledger) only sees ROOT; worktree edits reach us via the ledger.
paths = [(Path(c) if Path(c).is_absolute() else ROOT / c).resolve() for c in changed]
src = [f for f in paths if f.exists() and str(f).endswith(VERIFY_EXT) and rel(f).startswith(("apps/", "packages/", "workers/"))]
if not src:
    sys.exit(0)

pkgs: set[Path] = set()
py_roots: set[Path] = set()
notes = []
for path in src:
    top = repo_root(path)
    why = bootstrap_problem(path)
    if why:
        if why not in notes:
            notes.append(why)
        continue
    for parent in [path, *path.parents]:
        if parent == top:
            break
        if (parent / "package.json").exists():
            pkgs.add(parent)
            break
        if (parent / "pyproject.toml").exists():
            py_roots.add(parent)
            break

failures = []
pg_up = port_open(POSTGRES_PORT)
for pkg in sorted(pkgs):
    pj = json.loads((pkg / "package.json").read_text())
    scripts = pj.get("scripts", {})
    if "typecheck" in scripts:
        c, o = run(["pnpm", "run", "typecheck"], cwd=pkg, timeout=deadline, env=checkout_env(pkg))
        if c != 0:
            failures.append(f"[{pkg.name}] typecheck failed:\n{tail(o, 25)}")
    if "test" in scripts:
        if pkg.name == "db" and pkg.parent.name == "packages" and not pg_up:
            notes.append(f"[{pkg.name}] tests skipped: Postgres :{POSTGRES_PORT} is not reachable (pnpm infra:up)")
            continue
        c, o = run(["pnpm", "run", "test"], cwd=pkg, timeout=deadline, env=checkout_env(pkg))
        if c != 0:
            failures.append(f"[{pkg.name}] tests failed:\n{tail(o, 40)}")
for w in sorted(py_roots):
    if not pg_up:
        notes.append(f"[{rel(w)}] pytest skipped: Postgres :{POSTGRES_PORT} is not reachable (test_jobs needs it)")
    else:
        pyexe = venv_python(w)
        c, o = run([str(pyexe) if pyexe else "python3", "-m", "pytest", "-q"], cwd=w, timeout=deadline, env=checkout_env(w))
        if c != 0:
            failures.append(f"[{rel(w)}] pytest failed:\n{tail(o, 40)}")

if failures:
    print(json.dumps({
        "decision": "block",
        "reason": "Verification failed for the packages you changed. Fix these before finishing:\n\n" + "\n\n".join(failures + notes),
    }))
    sys.exit(0)
if notes:
    print("stop-verify: " + "; ".join(notes), file=sys.stderr)
sys.exit(0)
