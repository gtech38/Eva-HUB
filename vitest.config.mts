import { defineConfig } from "vitest/config";

// Root entry point: `pnpm exec vitest run` here runs every TypeScript package in one process.
// (Vitest 4 removed `vitest.workspace.ts`; `test.projects` is its replacement.) Each project has its
// own vitest.config.{ts,mts}; collection globs live in vitest.shared.mts. `pnpm test` does not use
// this file: it is `pnpm -r test`, i.e. `vitest run` inside each package. Add new packages here.
export default defineConfig({
  test: {
    projects: ["packages/shared", "packages/db", "apps/web", "apps/admin"],
  },
});
