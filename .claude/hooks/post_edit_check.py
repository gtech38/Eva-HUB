#!/usr/bin/env python3
"""PostToolUse (Edit|Write): fast feedback after every source edit.

  * TypeScript: incremental `tsc --noEmit` for the package + run the sibling test file.
  * Python:     `pytest` on the sibling test file (plus the edited file if it is itself a test).
  * SOLID heuristics on the edited file (size, long functions, fan-in of imports, god classes).

Failures and warnings are returned to Claude via exit 2 so they are acted on immediately.
Set HOOK_FAST=1 to skip the type-check (tests still run).
"""
import json
import os
import re
import sys
from pathlib import Path

from _common import PY_EXT, ROOT, TS_EXT, existing_test, file_from_payload, is_test, package_root, read_payload, rel, run, tail

p = read_payload()
if p.get("tool_name") not in {"Edit", "Write", "MultiEdit"}:
    sys.exit(0)
path = file_from_payload(p)
if not path or not path.exists() or path.suffix not in TS_EXT | PY_EXT:
    sys.exit(0)
r = rel(path)
if not (r.startswith("apps/") or r.startswith("packages/") or r.startswith("workers/")):
    sys.exit(0)

problems: list[str] = []
warnings: list[str] = []

# ── SOLID / size heuristics (advisory) ────────────────────────────────────────
try:
    text = path.read_text(encoding="utf-8", errors="replace")
except Exception:
    text = ""
lines = text.splitlines()
if not is_test(path):
    if len(lines) > 400:
        warnings.append(f"{r} is {len(lines)} lines. Single Responsibility: split by concern (a module should fit in one screenful of intent).")
    # crude long-function detector
    fn_starts = [i for i, l in enumerate(lines) if re.match(r"^\s*(export\s+)?(async\s+)?(function\s+\w+|def\s+\w+|const\s+\w+\s*=\s*(async\s*)?\()", l)]
    for a, b in zip(fn_starts, fn_starts[1:] + [len(lines)]):
        if b - a > 80:
            warnings.append(f"{r}:{a + 1} function spans ~{b - a} lines. Extract steps into named helpers.")
            break
    if path.suffix in TS_EXT:
        imports = re.findall(r"^\s*import\s.+?from\s+['\"]([^'\"]+)['\"]", text, re.M)
        if len(imports) > 15:
            warnings.append(f"{r} imports {len(imports)} modules. High coupling: does this module have one reason to change?")
        if "@hub/shared\"" in text and "\"use client\"" in text[:200]:
            problems.append(f"{r} is a client component importing `@hub/shared` root (pulls nodemailer/prisma into the browser bundle). Import a subpath like `@hub/shared/i18n`.")
        if re.search(r"prisma\.\w+\.(findMany|findFirst|count|updateMany|deleteMany)\(\s*\)", text):
            warnings.append(f"{r} has an unscoped Prisma query (no `where`). Every event-owned query must filter by eventId/studioId (tenant isolation).")
    if path.suffix in PY_EXT:
        methods = re.findall(r"^\s{4}def\s+(?!_)\w+", text, re.M)
        if len(methods) > 12:
            warnings.append(f"{r} has {len(methods)} public methods on one class. Interface Segregation: split roles.")

# ── Type-check + tests ────────────────────────────────────────────────────────
pkg = package_root(path)
if pkg:
    if path.suffix in TS_EXT:
        if not os.environ.get("HOOK_FAST"):
            code, out = run(["pnpm", "exec", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", ".tsbuildinfo-hook"], cwd=pkg, timeout=150)
            if code not in (0,):
                problems.append(f"Type errors in {rel(pkg)}:\n{tail(out, 30)}")
        test_file = path if is_test(path) else existing_test(path)
        if test_file:
            pj = json.loads((pkg / "package.json").read_text()) if (pkg / "package.json").exists() else {}
            deps = {**pj.get("dependencies", {}), **pj.get("devDependencies", {})}
            if "vitest" in deps:
                cmd = ["pnpm", "exec", "vitest", "run", str(test_file), "--reporter=dot"]
            else:
                cmd = ["node", "--import", "tsx", "--test", str(test_file)]
            code, out = run(cmd, cwd=pkg, timeout=150)
            if code != 0:
                problems.append(f"Tests failed ({rel(test_file)}):\n{tail(out, 40)}")
    elif path.suffix in PY_EXT:
        test_file = path if is_test(path) else existing_test(path)
        if test_file:
            py = pkg / ".venv" / "bin" / "python"
            cmd = [str(py) if py.exists() else "python3", "-m", "pytest", "-q", "-x", str(test_file)]
            code, out = run(cmd, cwd=pkg, timeout=180)
            if code != 0:
                problems.append(f"pytest failed ({rel(test_file)}):\n{tail(out, 40)}")

if problems or warnings:
    print("\n\n".join(["post-edit check:"] + problems + [f"WARN {w}" for w in warnings]), file=sys.stderr)
    sys.exit(2)
sys.exit(0)
