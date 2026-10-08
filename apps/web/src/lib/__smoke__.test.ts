import { expect, it } from "vitest";

// INF-001 acceptance: proves `pnpm --filter @hub/web test` discovers and runs vitest files.
// Delete before merging.
it("vitest discovers tests in apps/web", () => {
  expect(1).toBe(1);
});
