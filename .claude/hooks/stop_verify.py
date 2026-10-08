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

from _common import ROOT, SRC_EXT, Deadline, port_open, read_payload, read_touched, run, tail

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
src = [c for c in changed if c.startswith(("apps/", "packages/", "workers/")) and c.endswith(VERIFY_EXT) and (ROOT / c).exists()]
if not src:
    sys.exit(0)

pkgs: set[Path] = set()
py = False
for c in src:
    path = ROOT / c
    for parent in [path, *path.parents]:
        if parent == ROOT:
            break
        if (parent / "package.json").exists():
            pkgs.add(parent)
            break
        if (parent / "pyproject.toml").exists():
            py = True
            break

failures = []
notes = []
pg_up = port_open(POSTGRES_PORT)
for pkg in sorted(pkgs):
    pj = json.loads((pkg / "package.json").read_text())
    scripts = pj.get("scripts", {})
    if "typecheck" in scripts:
        c, o = run(["pnpm", "run", "typecheck"], cwd=pkg, timeout=deadline)
        if c != 0:
            failures.append(f"[{pkg.name}] typecheck failed:\n{tail(o, 25)}")
    if "test" in scripts:
        if pkg == ROOT / "packages" / "db" and not pg_up:
            notes.append(f"[{pkg.name}] tests skipped: Postgres :{POSTGRES_PORT} is not reachable (pnpm infra:up)")
            continue
        c, o = run(["pnpm", "run", "test"], cwd=pkg, timeout=deadline)
        if c != 0:
            failures.append(f"[{pkg.name}] tests failed:\n{tail(o, 40)}")
if py:
    if not pg_up:
        notes.append(f"[workers/media] pytest skipped: Postgres :{POSTGRES_PORT} is not reachable (test_jobs needs it)")
    else:
        w = ROOT / "workers" / "media"
        pyexe = w / ".venv" / "bin" / "python"
        c, o = run([str(pyexe) if pyexe.exists() else "python3", "-m", "pytest", "-q"], cwd=w, timeout=deadline)
        if c != 0:
            failures.append(f"[workers/media] pytest failed:\n{tail(o, 40)}")

if failures:
    print(json.dumps({
        "decision": "block",
        "reason": "Verification failed for the packages you changed. Fix these before finishing:\n\n" + "\n\n".join(failures + notes),
    }))
    sys.exit(0)
if notes:
    print("stop-verify: " + "; ".join(notes), file=sys.stderr)
sys.exit(0)
