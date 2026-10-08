import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_ENV, loadRootEnv, type EnvTarget } from "./setup.ts";

const tempEnv = (body: string) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "hub-env-")), ".env");
  writeFileSync(file, body);
  return file;
};

describe("test/setup.ts", () => {
  it("points at the single root .env, next to pnpm-workspace.yaml", () => {
    expect(path.basename(ROOT_ENV)).toBe(".env");
    expect(existsSync(path.join(path.dirname(ROOT_ENV), "pnpm-workspace.yaml"))).toBe(true);
  });

  it("fills variables that are missing but never overrides ones already set (CI wins)", () => {
    const target: EnvTarget = { DATABASE_URL: "postgresql://ci@localhost:5433/hub" };
    loadRootEnv(tempEnv("DATABASE_URL=postgresql://file@localhost/x\nAUTH_SECRET=from-the-file-0123456789\n"), target);
    expect(target.DATABASE_URL).toBe("postgresql://ci@localhost:5433/hub");
    expect(target.AUTH_SECRET).toBe("from-the-file-0123456789");
  });

  it("treats a missing .env as nothing to load", () => {
    const target: EnvTarget = {};
    expect(() => loadRootEnv(path.join(tmpdir(), "no-such-dir-hub", ".env"), target)).not.toThrow();
    expect(target).toStrictEqual({});
  });
});
