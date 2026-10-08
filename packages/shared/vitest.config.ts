import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@hub/shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // exFAT writes AppleDouble "._*" twins next to every file; never collect them.
    exclude: [...configDefaults.exclude, "**/._*"],
  },
});
