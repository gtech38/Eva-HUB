import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Every service reads the single root .env, exactly as next.config.ts does, so env() parses in tests.
// Resolved from this file rather than cwd: vitest may run from the app or from the repo root.
// Variables already set (CI) win; a missing file is not an error.
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
