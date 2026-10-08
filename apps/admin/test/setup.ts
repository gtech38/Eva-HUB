import { config } from "dotenv";
import { fileURLToPath } from "node:url";

/** The single root .env every service reads (next.config.ts loads the same file). */
export const ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));

export type EnvTarget = Record<string, string | undefined>;

/**
 * Load `file` into `target` the way next.config.ts does: variables already set (CI) win and a
 * missing file is not an error. Resolved from this file, not cwd, because vitest may run from the
 * app or from the repo root.
 */
export function loadRootEnv(file: string = ROOT_ENV, target: EnvTarget = process.env): void {
  config({ path: file, processEnv: target as Record<string, string> });
}

loadRootEnv();
