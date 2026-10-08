#!/usr/bin/env python3
"""UserPromptSubmit: inject a short standing reminder. Output on stdout becomes context."""
import sys

print(
    "Standing rules: red→green→refactor (write the failing test first; the TDD gate blocks source edits with no test). "
    "Keep SOLID: one reason to change per module, depend on the adapter interfaces in packages/shared (storage/email/sms), "
    "never bypass can() or tenant scoping. Finish with `pnpm verify`. Load skills: tdd-workflow, solid-design, and the area skill."
)
sys.exit(0)
