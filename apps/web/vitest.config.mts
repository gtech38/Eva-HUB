import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { exclude, include } from "../../vitest.shared.mts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // tsconfig.json has "jsx": "preserve" for Next's compiler; tests importing .tsx need it compiled.
  // (Vite 8 transforms with oxc, not esbuild.)
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      // Same as tsconfig.json "paths": { "@/*": ["./src/*"] }.
      "@/": here("./src/"),
      // Next's `server-only` guard throws outside a React Server bundle; tests import server modules directly.
      "server-only": here("./test/server-only.ts"),
    },
  },
  test: {
    name: "@hub/web",
    environment: "node",
    include,
    exclude,
    setupFiles: ["./test/setup.ts"],
  },
});
