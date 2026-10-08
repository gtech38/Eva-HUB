import { defineConfig } from "vitest/config";
import { exclude, include } from "../../vitest.shared.mts";

export default defineConfig({
  test: {
    name: "@hub/shared",
    environment: "node",
    include,
    exclude,
  },
});
