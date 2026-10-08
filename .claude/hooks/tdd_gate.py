#!/usr/bin/env python3
"""PreToolUse (Edit|Write): refuse to write production code that has no test.

Red → green → refactor is enforced structurally: a source file under apps/, packages/ or
workers/ may only be created or edited when a matching test file already exists. Write the
failing test first, run it, watch it fail, then come back.

Escape hatches (both leave an audit trail):
  * put `// tdd-exempt: <reason>` (or `# tdd-exempt:`) in the content you are writing — for
    glue/wiring that genuinely has no behaviour; a file that already carries the marker in its
    first 4 KB stays exempt for later edits (Edit, Write and MultiEdit payloads are all scanned);
  * TDD_GATE=off in the environment for a one-off session (don't commit with it on).
"""
import os
import sys

from _common import ROOT, existing_test, exempt_marker, file_from_payload, is_source, is_test, read_payload, rel, test_candidates

if os.environ.get("TDD_GATE", "").lower() in {"off", "0", "false"}:
    sys.exit(0)

p = read_payload()
if p.get("tool_name") not in {"Edit", "Write", "MultiEdit"}:
    sys.exit(0)

path = file_from_payload(p)
if not path or not is_source(path) or is_test(path):
    sys.exit(0)

if existing_test(path):
    sys.exit(0)

reason = exempt_marker(p, path)
if reason:
    print(f"tdd-gate: exempt ({reason}) — {rel(path)}", file=sys.stderr)
    sys.exit(0)

cands = test_candidates(path)
suggest = rel(cands[0]) if cands else "<package>/tests/..."
msg = f"""TDD gate: {rel(path)} has no test, so this edit is blocked.

Write the failing test first, then retry this edit:
  1. Create {suggest} (or any of: {", ".join(sorted({rel(c) for c in cands[:3]}))})
  2. Make it assert the behaviour this change should produce.
  3. Run it and confirm it FAILS (TS: `pnpm exec vitest run <file>` in the package or `pnpm --filter <pkg> test`; Py: `cd workers/media && .venv/bin/pytest <file>`).
  4. Re-issue this edit; the gate passes once the test file exists.

If this file is pure wiring with no behaviour to test, include the marker
`// tdd-exempt: <why>` in the content you write. Load the `tdd-workflow` skill for details."""
print(msg, file=sys.stderr)
sys.exit(2)
