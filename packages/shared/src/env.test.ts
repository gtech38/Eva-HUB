import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// The value shipped in .env.example. It must keep working locally and must never pass in production.
const DEV_SECRET = "dev-only-change-me-0123456789abcdef";

/** Every variable the tests care about; anything not given is removed from process.env. */
const KEYS = [
  "NODE_ENV",
  "APP_ENV",
  "NEXT_PHASE",
  "DATABASE_URL",
  "ROOT_DOMAIN",
  "WEB_ORIGIN",
  "ADMIN_ORIGIN",
  "WORKER_INTERNAL_URL",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_FORCE_PATH_STYLE",
  "EMAIL_PROVIDER",
  "AUTH_SECRET",
  "FACE_MATCH_THRESHOLD",
  "WEB_PORT",
  "SMTP_PORT",
  "SESSION_TTL_DAYS",
  "INVITE_SESSION_TTL_DAYS",
  "EMAIL_FROM",
  "TRUSTED_PROXY_HOPS",
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
    APP_ENV: "production",
    AUTH_SECRET: randomBytes(32).toString("base64url"),
    ROOT_DOMAIN: "studio.example.com",
    WEB_ORIGIN: "https://studio.example.com",
    ADMIN_ORIGIN: "https://admin.studio.example.com",
    WORKER_INTERNAL_URL: "http://worker:8010",
    S3_ENDPOINT: "https://s3.example.com",
    S3_PUBLIC_ENDPOINT: "https://media.example.com",
    S3_ACCESS_KEY: randomBytes(10).toString("hex"),
    S3_SECRET_KEY: randomBytes(20).toString("hex"),
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

/** The message env() throws, or "" when it does not throw. */
function messageOf(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

  it("accepts a complete production config", async () => {
    const vars = production();
    const env = await envWith(vars);
    expect(env().AUTH_SECRET).toBe(vars.AUTH_SECRET);
  });

  it("rejects a production AUTH_SECRET shorter than 32 bytes", async () => {
    const env = await envWith({ ...production(), AUTH_SECRET: randomBytes(16).toString("hex") });
    expect(() => env()).toThrow(/AUTH_SECRET.*32 bytes/);
  });

  it("accepts 32-byte hex and base64 secrets", async () => {
    for (const secret of [randomBytes(32).toString("hex"), randomBytes(32).toString("base64"), randomBytes(48).toString("base64url")]) {
      const env = await envWith({ ...production(), AUTH_SECRET: secret });
      expect(env().AUTH_SECRET).toBe(secret);
    }
  });

  it("requires AUTH_SECRET to be hex or base64 in production: a long passphrase is not accepted", async () => {
    const env = await envWith({ ...production(), AUTH_SECRET: "correct horse battery staple correct horse" });
    expect(() => env()).toThrow(/AUTH_SECRET.*hex or base64/);
  });

  it("names the AUTH_SECRET rule as a length check, not an entropy test", async () => {
    const env = await envWith({ ...production(), AUTH_SECRET: DEV_SECRET });
    expect(messageOf(env)).toMatch(/length/i);
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

  it.each([
    ["ROOT_DOMAIN unset", { ROOT_DOMAIN: undefined }, /ROOT_DOMAIN/],
    ["ROOT_DOMAIN=localhost", { ROOT_DOMAIN: "localhost" }, /ROOT_DOMAIN/],
    ["WEB_ORIGIN unset", { WEB_ORIGIN: undefined }, /WEB_ORIGIN/],
    ["WEB_ORIGIN on localhost", { WEB_ORIGIN: "http://localhost:3000" }, /WEB_ORIGIN/],
    ["ADMIN_ORIGIN unset", { ADMIN_ORIGIN: undefined }, /ADMIN_ORIGIN/],
    ["ADMIN_ORIGIN on 127.0.0.1", { ADMIN_ORIGIN: "http://127.0.0.1:3001" }, /ADMIN_ORIGIN/],
    ["WORKER_INTERNAL_URL unset", { WORKER_INTERNAL_URL: undefined }, /WORKER_INTERNAL_URL/],
    ["the default minio S3_ACCESS_KEY", { S3_ACCESS_KEY: "minio" }, /S3_ACCESS_KEY/],
    ["the default minio S3_SECRET_KEY", { S3_SECRET_KEY: "minio12345" }, /S3_SECRET_KEY/],
  ] satisfies [string, Vars, RegExp][])("rejects %s in production", async (_name, override, expected) => {
    const env = await envWith({ ...production(), ...override });
    expect(() => env()).toThrow(expected);
  });

  it("allows an explicit loopback WORKER_INTERNAL_URL (single-host deploy) but not an implicit one", async () => {
    const env = await envWith({ ...production(), WORKER_INTERNAL_URL: "http://127.0.0.1:8010" });
    expect(env().WORKER_INTERNAL_URL).toBe("http://127.0.0.1:8010");
  });

  it("never echoes S3 key values in the error", async () => {
    const env = await envWith({ ...production(), S3_ACCESS_KEY: "minio", S3_SECRET_KEY: "minio12345" });
    const message = messageOf(env);
    expect(message).toMatch(/S3_SECRET_KEY/);
    expect(message).not.toContain("minio12345");
  });

  it("lists every production problem at once", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production", APP_ENV: "production" });
    const message = messageOf(env);
    for (const key of ["AUTH_SECRET", "ROOT_DOMAIN", "WEB_ORIGIN", "ADMIN_ORIGIN", "WORKER_INTERNAL_URL", "S3_PUBLIC_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "EMAIL_PROVIDER"]) {
      expect(message, key).toContain(key);
    }
  });
});

describe("blank values mean unset (same as the worker's _value in config.py)", () => {
  it.each([
    ["FACE_MATCH_THRESHOLD", "", 0.363],
    ["FACE_MATCH_THRESHOLD", "   ", 0.363],
    ["WEB_PORT", "", 3000],
    ["SMTP_PORT", " ", 1025],
    ["SESSION_TTL_DAYS", "", 30],
    ["INVITE_SESSION_TTL_DAYS", "\t", 90],
    ["EMAIL_FROM", "", "Event Hub <hello@localhost>"],
    ["ROOT_DOMAIN", "", "localhost"],
  ] satisfies [(typeof KEYS)[number], string, unknown][])("%s=%j gets the default %j", async (key, blank, expected) => {
    const env = await envWith({ ...local, [key]: blank });
    expect((env() as Record<string, unknown>)[key]).toBe(expected);
  });

  it("a blank FACE_MATCH_THRESHOLD never becomes 0 (0 would match every face)", async () => {
    const env = await envWith({ ...local, FACE_MATCH_THRESHOLD: "" });
    expect(env().FACE_MATCH_THRESHOLD).not.toBe(0);
  });

  it.each(["S3_BUCKET", "S3_ENDPOINT", "DATABASE_URL", "AUTH_SECRET"] as const)("a blank required %s is a 'required' error", async (key) => {
    const env = await envWith({ ...local, [key]: "  " });
    expect(() => env()).toThrow(new RegExp(`${key}: Required`));
  });

  it.each(["ROOT_DOMAIN", "WEB_ORIGIN", "ADMIN_ORIGIN", "WORKER_INTERNAL_URL"] as const)("a blank %s fails the production check", async (key) => {
    const env = await envWith({ ...production(), [key]: "" });
    expect(() => env()).toThrow(new RegExp(key));
  });

  it("trims surrounding whitespace from non-blank values (as the worker does)", async () => {
    const env = await envWith({ ...local, S3_BUCKET: " hub-media\t", APP_ENV: " production ", AUTH_SECRET: `  ${DEV_SECRET} ` });
    expect(() => env()).toThrow(/AUTH_SECRET/); // " production " counts as production
    const dev = await envWith({ ...local, S3_BUCKET: " hub-media\t", ROOT_DOMAIN: " studio.example.com " });
    expect(dev().S3_BUCKET).toBe("hub-media");
    expect(dev().ROOT_DOMAIN).toBe("studio.example.com");
  });

  it("does not modify process.env", async () => {
    const env = await envWith({ ...local, S3_PUBLIC_ENDPOINT: " " });
    env();
    expect(process.env.S3_PUBLIC_ENDPOINT).toBe(" ");
  });
});

describe("TRUSTED_PROXY_HOPS (SHR-003)", () => {
  it("defaults to 1 and accepts 1..10", async () => {
    expect((await envWith(local))().TRUSTED_PROXY_HOPS).toBe(1);
    expect((await envWith({ ...local, TRUSTED_PROXY_HOPS: "2" }))().TRUSTED_PROXY_HOPS).toBe(2);
  });

  it.each(["0", "11", "1.5", "two", "0x2", "1e1", "2.0"])("rejects %s (digits only)", async (value) => {
    const env = await envWith({ ...local, TRUSTED_PROXY_HOPS: value });
    expect(() => env()).toThrow(/TRUSTED_PROXY_HOPS/);
  });
});

describe("FACE_MATCH_THRESHOLD range", () => {
  it.each(["0", "-0.1", "1.5"])("rejects %s: it must be in (0, 1], and <= 0 would match every face", async (value) => {
    const env = await envWith({ ...local, FACE_MATCH_THRESHOLD: value });
    expect(() => env()).toThrow(/FACE_MATCH_THRESHOLD/);
  });

  it("accepts values in (0, 1]", async () => {
    expect((await envWith({ ...local, FACE_MATCH_THRESHOLD: "1" }))().FACE_MATCH_THRESHOLD).toBe(1);
    expect((await envWith({ ...local, FACE_MATCH_THRESHOLD: "0.5" }))().FACE_MATCH_THRESHOLD).toBe(0.5);
  });
});

describe("loopback detection", () => {
  it.each([
    ["ROOT_DOMAIN", "127.4.5.6"],
    ["WEB_ORIGIN", "http://127.0.0.2:3000"],
    ["ADMIN_ORIGIN", "http://[::1]:3001"],
    ["ROOT_DOMAIN", "::1"],
    ["WEB_ORIGIN", "http://app.localhost:3000"],
    ["WEB_ORIGIN", "http://"],
    ["ROOT_DOMAIN", "localhost."],
    ["ADMIN_ORIGIN", "http://localhost.:3001"],
    ["WEB_ORIGIN", "http://[::ffff:127.0.0.1]:3000"],
    ["ROOT_DOMAIN", "::ffff:127.0.0.1"],
  ] as const)("rejects %s=%s in production", async (key, value) => {
    const env = await envWith({ ...production(), [key]: value });
    expect(() => env()).toThrow(new RegExp(key));
  });

  it("does not treat a public host that merely starts with 127 as loopback", async () => {
    const env = await envWith({ ...production(), WEB_ORIGIN: "https://127studio.example.com" });
    expect(env().WEB_ORIGIN).toBe("https://127studio.example.com");
  });
});

describe("APP_ENV and NODE_ENV", () => {
  it("APP_ENV=production enforces the rules even when NODE_ENV is development", async () => {
    const env = await envWith({ ...local, APP_ENV: "production" });
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it("APP_ENV=development relaxes them for a local `next start` (NODE_ENV=production)", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production", APP_ENV: "development" });
    expect(env().AUTH_SECRET).toBe(DEV_SECRET);
  });

  it("an empty APP_ENV counts as unset, so NODE_ENV decides", async () => {
    const dev = await envWith({ ...local, APP_ENV: "" });
    expect(dev().AUTH_SECRET).toBe(DEV_SECRET);
    const prod = await envWith({ ...local, NODE_ENV: "production", APP_ENV: "" });
    expect(() => prod()).toThrow(/AUTH_SECRET/);
  });

  it.each(["prod", "Production", "PRODUCTION", "pro duction"])("rejects APP_ENV=%j instead of silently skipping the checks", async (bad) => {
    const env = await envWith({ ...production(), APP_ENV: bad });
    expect(() => env()).toThrow(/APP_ENV/);
  });

  it("an empty NODE_ENV counts as unset", async () => {
    const env = await envWith({ ...local, NODE_ENV: "" });
    expect(env().NODE_ENV).toBe("development");
  });

  it("warns once, without values, when NODE_ENV=production but APP_ENV is not production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const appEnv of [undefined, "development"]) {
      warn.mockClear();
      const env = await envWith({ ...production(), APP_ENV: appEnv, AUTH_SECRET: DEV_SECRET.replace(/-/g, "") + "ab" });
      try {
        env();
        env();
      } catch {
        // the unset case throws on the weak secret; the warning is what is under test
      }
      expect(warn, String(appEnv)).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0]?.[0]);
      expect(text).toMatch(/APP_ENV/);
      expect(text).not.toContain(DEV_SECRET);
    }
  });

  it("does not warn when APP_ENV=production, or outside production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (await envWith(production()))();
    (await envWith(local))();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("next build", () => {
  it("skips the production checks during `next build` (NEXT_PHASE=phase-production-build)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = await envWith({ ...local, NODE_ENV: "production", NEXT_PHASE: "phase-production-build" });
    expect(env().AUTH_SECRET).toBe(DEV_SECRET);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not skip them during the build when APP_ENV=production says this is a production build", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production", APP_ENV: "production", NEXT_PHASE: "phase-production-build" });
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it("still enforces them when the server runs (NEXT_PHASE=phase-production-server)", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production", NEXT_PHASE: "phase-production-server" });
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it("still reports malformed variables during the build", async () => {
    const env = await envWith({ ...local, NODE_ENV: "production", NEXT_PHASE: "phase-production-build", APP_ENV: "prod" });
    expect(() => env()).toThrow(/APP_ENV/);
  });
});

describe("S3_FORCE_PATH_STYLE", () => {
  it.each(["false", "FALSE", "0", "no", "off", " false "])("%j is false", async (value) => {
    const env = await envWith({ ...local, S3_FORCE_PATH_STYLE: value });
    expect(env().S3_FORCE_PATH_STYLE).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes", "on"])("%j is true", async (value) => {
    const env = await envWith({ ...local, S3_FORCE_PATH_STYLE: value });
    expect(env().S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("is true when unset or empty", async () => {
    expect((await envWith(local))().S3_FORCE_PATH_STYLE).toBe(true);
    expect((await envWith({ ...local, S3_FORCE_PATH_STYLE: "" }))().S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("rejects values that are neither true nor false", async () => {
    const env = await envWith({ ...local, S3_FORCE_PATH_STYLE: "maybe" });
    expect(() => env()).toThrow(/S3_FORCE_PATH_STYLE/);
  });
});

describe("secretBytes", () => {
  it("decodes hex and base64 and returns null for anything else", async () => {
    const { secretBytes } = await import("./env.ts");
    expect(secretBytes(randomBytes(32).toString("hex"))).toBe(32);
    expect(secretBytes(randomBytes(32).toString("base64"))).toBe(32);
    expect(secretBytes(randomBytes(32).toString("base64url"))).toBe(32);
    expect(secretBytes("correct horse battery staple")).toBeNull();
    expect(secretBytes("")).toBeNull();
  });
});
