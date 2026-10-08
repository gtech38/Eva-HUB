#!/usr/bin/env python3
"""Stop: before Claude ends its turn, verify the packages it touched.

Runs typecheck + tests for every workspace package with uncommitted source changes (and pytest
for the worker). If anything fails, the stop is blocked once with the failure output so Claude
finishes the job instead of handing back red code. `stop_hook_active` prevents loops.
"""
import json
import sys
from pathlib import Path

from _common import ROOT, run, tail

p = {}
try:
    p = json.load(sys.stdin)
except Exception:
    pass
if p.get("stop_hook_active"):
    sys.exit(0)

code, out = run(["git", "status", "--porcelain"], cwd=ROOT, timeout=20)
changed = [l[3:].strip().strip('"') for l in out.splitlines() if l.strip()]
src = [c for c in changed if (c.startswith(("apps/", "packages/", "workers/"))) and c.endswith((".ts", ".tsx", ".mts", ".py", ".prisma"))]
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
for pkg in sorted(pkgs):
    pj = json.loads((pkg / "package.json").read_text())
    scripts = pj.get("scripts", {})
    if "typecheck" in scripts:
        c, o = run(["pnpm", "run", "typecheck"], cwd=pkg, timeout=240)
        if c != 0:
            failures.append(f"[{pkg.name}] typecheck failed:\n{tail(o, 25)}")
    if "test" in scripts:
        c, o = run(["pnpm", "run", "test"], cwd=pkg, timeout=300)
        if c != 0:
            failures.append(f"[{pkg.name}] tests failed:\n{tail(o, 40)}")
if py:
    w = ROOT / "workers" / "media"
    pyexe = w / ".venv" / "bin" / "python"
    c, o = run([str(pyexe) if pyexe.exists() else "python3", "-m", "pytest", "-q"], cwd=w, timeout=400)
    if c != 0:
        failures.append(f"[workers/media] pytest failed:\n{tail(o, 40)}")

if failures:
    print(json.dumps({
        "decision": "block",
        "reason": "Verification failed for the packages you changed. Fix these before finishing:\n\n" + "\n\n".join(failures),
    }))
    sys.exit(0)
sys.exit(0)
