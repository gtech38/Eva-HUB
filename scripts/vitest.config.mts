import { defineConfig } from "vitest/config";
import { exclude } from "../vitest.shared.mts";

// Tests for repo tooling sit beside the scripts as `*.test.mjs` (plain ESM, no TS build).
export default defineConfig({
  test: {
    name: "@hub/scripts",
    environment: "node",
    include: ["*.test.mjs"],
    exclude,
  },
});
