#!/usr/bin/env python3
"""PostToolUse (Edit|Write|MultiEdit): fast feedback after every source edit.

  * TypeScript: incremental `tsc --noEmit` for the package + run the sibling test file.
  * Python:     `pytest` on the sibling test file (plus the edited file if it is itself a test).
  * SOLID heuristics on the edited file (size, long functions, fan-in of imports, god classes).
  * Records the edited path in `.claude/.touched/<session_id>` so the Stop hook only re-verifies
    packages this session actually changed.

Problems (type errors, failing tests, tenant-isolation violations) exit 2 so Claude acts on them
immediately. Advisory warnings go to stderr with exit 0 so a large-but-untouched file does not
block every edit forever.

All subprocesses share one shrinking deadline (TOTAL_BUDGET_S) that stays under the 200 s hook
timeout in settings.json -- a hook killed by the harness passes silently, which is worse than a
"timed out" problem line. Set HOOK_FAST=1 to skip the type-check (tests still run).
"""
import json
import os
import re
import sys

from _common import (
    Deadline, PY_EXT, SRC_EXT, TS_EXT, bootstrap_problem, checkout_env, existing_test, file_from_payload, is_test, package_root, read_payload, record_touched, rel, run, tail, venv_python,
)

TOTAL_BUDGET_S = 170

p = read_payload()
if p.get("tool_name") not in {"Edit", "Write", "MultiEdit"}:
    sys.exit(0)
path = file_from_payload(p)
if not path or not path.exists() or path.suffix not in SRC_EXT:
    sys.exit(0)
r = rel(path)
if not (r.startswith("apps/") or r.startswith("packages/") or r.startswith("workers/")):
    sys.exit(0)

record_touched(p, path)
deadline = Deadline(TOTAL_BUDGET_S)

problems: list[str] = []
warnings: list[str] = []

# ── SOLID / size heuristics ───────────────────────────────────────────────────
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
        imports = re.findall(r"""^\s*import\s.+?from\s+['"]([^'"]+)['"]""", text, re.M)
        if len(imports) > 15:
            warnings.append(f"{r} imports {len(imports)} modules. High coupling: does this module have one reason to change?")
        use_client = re.search(r"""^\s*(['"])use client\1""", text[:200], re.M)
        root_import = re.search(r"""from\s+(['"])@hub/shared\1""", text)
        if use_client and root_import:
            problems.append(f"{r} is a client component importing `@hub/shared` root (pulls nodemailer/prisma into the browser bundle). Import a subpath like `@hub/shared/i18n`.")
        # Tenant isolation is a hard rule, not a style preference.
        if re.search(r"prisma\.\w+\.(findMany|findFirst|count|updateMany|deleteMany)\(\s*\)", text):
            problems.append(f"{r} has an unscoped Prisma query (no `where`). Every event-owned query must filter by eventId/studioId (tenant isolation).")
    if path.suffix in PY_EXT:
        methods = re.findall(r"^\s{4}def\s+(?!_)\w+", text, re.M)
        if len(methods) > 12:
            warnings.append(f"{r} has {len(methods)} public methods on one class. Interface Segregation: split roles.")

# ── Type-check + tests ────────────────────────────────────────────────────────
pkg = package_root(path)
not_ready = bootstrap_problem(path)
if not_ready:
    warnings.append(not_ready)
env = checkout_env(path)
if pkg and not not_ready:
    if path.suffix in TS_EXT:
        if not os.environ.get("HOOK_FAST"):
            code, out = run(["pnpm", "exec", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", ".tsbuildinfo-hook"], cwd=pkg, timeout=deadline, env=env)
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
            code, out = run(cmd, cwd=pkg, timeout=deadline, env=env)
            if code != 0:
                problems.append(f"Tests failed ({rel(test_file)}):\n{tail(out, 40)}")
    elif path.suffix in PY_EXT:
        test_file = path if is_test(path) else existing_test(path)
        if test_file:
            py = venv_python(pkg)
            cmd = [str(py) if py else "python3", "-m", "pytest", "-q", "-x", str(test_file)]
            code, out = run(cmd, cwd=pkg, timeout=deadline, env=env)
            if code != 0:
                problems.append(f"pytest failed ({rel(test_file)}):\n{tail(out, 40)}")

if problems:
    print("\n\n".join(["post-edit check:"] + problems + [f"WARN {w}" for w in warnings]), file=sys.stderr)
    sys.exit(2)
if warnings:
    print("\n\n".join(["post-edit check (advisory):"] + [f"WARN {w}" for w in warnings]), file=sys.stderr)
sys.exit(0)
