import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Same as tsconfig.json "paths": { "@/*": ["./src/*"] }.
      "@/": here("./src/"),
      // Next's `server-only` guard throws outside a React Server bundle; tests import server modules directly.
      "server-only": here("./test/server-only.ts"),
    },
  },
  test: {
    name: "@hub/admin",
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    // exFAT writes AppleDouble "._*" twins next to every file; never collect them.
    exclude: [...configDefaults.exclude, "**/._*"],
    setupFiles: ["./test/setup.ts"],
  },
});
