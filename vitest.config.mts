import { defineConfig } from "vitest/config";

// One runner for the TypeScript workspace. Vitest 4 replaced `vitest.workspace.ts` with
// `test.projects`; each entry has its own vitest.config.ts. `pnpm test` still runs per package
// (`pnpm -r test` -> `vitest run`); this file lets `pnpm exec vitest` at the root run them all.
export default defineConfig({
  test: {
    projects: ["packages/shared", "packages/db", "apps/web", "apps/admin"],
  },
});
