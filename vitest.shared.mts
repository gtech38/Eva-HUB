import { configDefaults } from "vitest/config";

// Collection globs shared by every package's vitest config. They must cover every location the
// TDD gate (.claude/hooks/_common.py test_candidates) accepts as "this source has a test", or a
// test the gate counts would never run. `__tests__/` dirs sit under src/ and are covered by src/**.
export const include = [
  "src/**/*.{test,spec}.{ts,tsx}",
  "test/**/*.{test,spec}.{ts,tsx}",
  "tests/**/*.{test,spec}.{ts,tsx}",
];

// exFAT writes AppleDouble "._*" twins next to every file; never collect them.
export const exclude = [...configDefaults.exclude, "**/._*"];
