import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// The value shipped in .env.example. It must keep working locally and must never pass in production.
const DEV_SECRET = "dev-only-change-me-0123456789abcdef";

/** Every variable the tests care about; anything not given is removed from process.env. */
const KEYS = [
  "NODE_ENV",
  "APP_ENV",
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "EMAIL_PROVIDER",
  "AUTH_SECRET",
] as const;
type Vars = Partial<Record<(typeof KEYS)[number], string>>;

const local: Vars = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://hub:hub@localhost:5433/hub",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "hub-media",
  S3_ACCESS_KEY: "minio",
  S3_SECRET_KEY: "minio12345",
  AUTH_SECRET: DEV_SECRET,
};

/** A production config that should pass; generated per run so no secret-looking literal is committed. */
function production(): Vars {
  return {
    ...local,
    NODE_ENV: "production",
    AUTH_SECRET: randomBytes(32).toString("base64url"),
    S3_PUBLIC_ENDPOINT: "https://media.example.com",
    EMAIL_PROVIDER: "smtp",
  };
}

/** Fresh module per call: env() caches its first parse. */
async function envWith(vars: Vars) {
  for (const k of KEYS) vi.stubEnv(k, vars[k]);
  vi.resetModules();
  const mod = await import("./env.ts");
  return mod.env;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env() production validation", () => {
  it("env() throws in production with the dev AUTH_SECRET", async () => {
    const env = await envWith({ ...production(), AUTH_SECRET: DEV_SECRET });
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it("accepts the dev AUTH_SECRET outside production", async () => {
    const env = await envWith(local);
    expect(env().AUTH_SECRET).toBe(DEV_SECRET);
  });

  it("accepts a production config with a 32-byte random AUTH_SECRET", async () => {
    const vars = production();
    const env = await envWith(vars);
    expect(env().AUTH_SECRET).toBe(vars.AUTH_SECRET);
  });

  it("rejects a production AUTH_SECRET with fewer than 32 random bytes", async () => {
    const env = await envWith({ ...production(), AUTH_SECRET: randomBytes(16).toString("hex") });
    expect(() => env()).toThrow(/AUTH_SECRET.*32 random bytes/);
  });

  it("never echoes the secret value in the error", async () => {
    const env = await envWith({ ...production(), AUTH_SECRET: DEV_SECRET });
    expect(() => env()).toThrow(expect.objectContaining({ message: expect.not.stringContaining(DEV_SECRET) }));
  });

  it("requires S3_PUBLIC_ENDPOINT in production", async () => {
    const env = await envWith({ ...production(), S3_PUBLIC_ENDPOINT: undefined });
    expect(() => env()).toThrow(/S3_PUBLIC_ENDPOINT/);
  });

  it("rejects EMAIL_PROVIDER=console in production (and the default is console)", async () => {
    const explicit = await envWith({ ...production(), EMAIL_PROVIDER: "console" });
    expect(() => explicit()).toThrow(/EMAIL_PROVIDER/);
    const defaulted = await envWith({ ...production(), EMAIL_PROVIDER: undefined });
    expect(() => defaulted()).toThrow(/EMAIL_PROVIDER/);
  });

  it("APP_ENV=production enforces the rules even when NODE_ENV is development", async () => {
    const env = await envWith({ ...local, APP_ENV: "production" });
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it("APP_ENV=development relaxes them for a local `next start` (NODE_ENV=production)", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production", APP_ENV: "development" });
    expect(env().AUTH_SECRET).toBe(DEV_SECRET);
  });

  it("lists every production problem at once", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production" });
    expect(() => env()).toThrow(/AUTH_SECRET[\s\S]*S3_PUBLIC_ENDPOINT[\s\S]*EMAIL_PROVIDER/);
  });
});

describe("secretBytes", () => {
  it("decodes hex and base64 and counts other strings by UTF-8 bytes", async () => {
    const { secretBytes } = await import("./env.ts");
    expect(secretBytes(randomBytes(32).toString("hex"))).toBe(32);
    expect(secretBytes(randomBytes(32).toString("base64"))).toBe(32);
    expect(secretBytes(randomBytes(32).toString("base64url"))).toBe(32);
    expect(secretBytes("correct horse battery staple")).toBe(28);
  });
});
