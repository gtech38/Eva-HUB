import { z } from "zod";

/**
 * A trimmed copy of the environment without blank values: `KEY=` (or whitespace only) means unset, so the default
 * applies or a required key is reported as missing, and other values lose surrounding whitespace. Same rule as
 * `_value()` in the worker's config.py. Without it `z.coerce.number()` turns "" into 0.
 */
export function withoutBlanks(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    const trimmed = v?.trim();
    if (trimmed) out[k] = trimmed;
  }
  return out;
}

const TRUE_FLAGS = ["1", "true", "yes", "on"];
const FALSE_FLAGS = ["0", "false", "no", "off"];

/**
 * Boolean flag, same vocabulary as the worker's `_bool` (config.py): 1/true/yes/on and 0/false/no/off,
 * case-insensitive; unset (blanks are removed by withoutBlanks) falls through to the default; anything else is
 * left for z.boolean() to reject. (`z.coerce.boolean()` would turn "false" into true.)
 */
function parseFlag(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (TRUE_FLAGS.includes(s)) return true;
  if (FALSE_FLAGS.includes(s)) return false;
  return v;
}

// One key per line: scripts/env-docs.mjs reads this object (key, `.default(...)`, `.optional()`) to
// generate docs/deploy/env.md and .env.example. Add the key's metadata in scripts/env-meta.mjs.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "production"]).optional(),
  ROOT_DOMAIN: z.string().default("localhost"),
  WEB_PORT: z.coerce.number().default(3000),
  ADMIN_PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  ADMIN_ORIGIN: z.string().default("http://localhost:3001"),

  DATABASE_URL: z.string(),

  S3_ENDPOINT: z.string(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_FORCE_PATH_STYLE: z.preprocess(parseFlag, z.boolean().default(true)),

  EMAIL_PROVIDER: z.enum(["smtp", "console"]).default("console"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  EMAIL_FROM: z.string().default("Event Hub <hello@localhost>"),

  SMS_PROVIDER: z.enum(["console"]).default("console"),

  AUTH_SECRET: z.string().min(16),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  INVITE_SESSION_TTL_DAYS: z.coerce.number().default(90),

  TRUSTED_PROXY_HOPS: z.string().regex(/^\d+$/).default("1").pipe(z.coerce.number().int().min(1).max(10)), // digits only; read by clientIp.ts
  RATE_LIMIT_SIGN_IN_IP: z.string().optional(), // RATE_LIMIT_*: "max/windowSec", parsed and bounded by ratePolicies.ts
  RATE_LIMIT_SIGN_IN_ADDRESS_IP: z.string().optional(),
  RATE_LIMIT_SIGN_IN_ADDRESS: z.string().optional(),
  RATE_LIMIT_OTP_VERIFY_ADDRESS: z.string().optional(),
  RATE_LIMIT_INVITE_IP: z.string().optional(),
  RATE_LIMIT_FACE_SEARCH_USER: z.string().optional(),
  RATE_LIMIT_FACE_SEARCH_CONCURRENT: z.string().optional(),
  RATE_LIMIT_ADMIN_MAGIC_LINK_IP: z.string().optional(),
  RATE_LIMIT_ADMIN_MAGIC_LINK_ADDRESS_IP: z.string().optional(),
  RATE_LIMIT_ADMIN_MAGIC_LINK_ADDRESS: z.string().optional(),

  WORKER_INTERNAL_URL: z.string().default("http://localhost:8010"),
  FACE_MATCH_THRESHOLD: z.coerce.number().gt(0).lte(1).default(0.363),
});

export type Env = z.infer<typeof schema>;

/**
 * TRUSTED_PROXY_HOPS through the schema's own rule (so boot validation and env() cannot disagree),
 * without requiring the rest of the environment. Throws a message naming the variable.
 */
export function parseTrustedProxyHops(source: Record<string, string | undefined> = process.env): number {
  const r = schema.shape.TRUSTED_PROXY_HOPS.safeParse(withoutBlanks({ v: source.TRUSTED_PROXY_HOPS }).v);
  if (!r.success) throw new Error(`TRUSTED_PROXY_HOPS must be an integer 1..10, got ${JSON.stringify(source.TRUSTED_PROXY_HOPS)}`);
  return r.data;
}

/** APP_ENV wins over NODE_ENV, so `next start` can be smoke-tested locally with APP_ENV=development. */
export function isProduction(e: Pick<Env, "NODE_ENV" | "APP_ENV">): boolean {
  return (e.APP_ENV ?? e.NODE_ENV) === "production";
}

const MIN_SECRET_BYTES = 32;
const PLACEHOLDER = /change-?me|dev-only|ci-only|placeholder/i;

// The local S3 credentials in .env.example and in the worker's DEFAULTS (config.py): never valid in production.
const DEV_S3_ACCESS_KEY = "minio";
const DEV_S3_SECRET_KEY = "minio12345";

/**
 * Bytes a hex or base64(url) secret decodes to, or null when it is neither (a passphrase, say).
 * This measures length only: it cannot tell a random value from `aaaa...`.
 */
export function secretBytes(secret: string): number | null {
  if (/^[0-9a-f]+$/i.test(secret) && secret.length % 2 === 0) return secret.length / 2;
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(secret)) return Math.floor((secret.replace(/=+$/, "").length * 6) / 8);
  return null;
}

/**
 * True unless the value names a usable non-loopback host: localhost (with or without a trailing dot), *.localhost,
 * 127.0.0.0/8, ::1, IPv4-mapped loopback, 0.0.0.0, no host at all, or anything that does not parse as a host
 * (a bare "::1", "http://") all count.
 */
function isLoopback(value: string): boolean {
  const raw = value.trim();
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `http://${raw}`).hostname;
  } catch {
    return true;
  }
  host = host.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "").toLowerCase();
  return (
    host === "" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "::1" ||
    /^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(host) ||
    host === "0.0.0.0"
  );
}

type ProductionIssue = { key: keyof Env; message: string };

/**
 * Settings that have safe local defaults but are wrong in production. `raw` is the unparsed environment, used
 * to tell "unset" from "explicitly set to the default". Messages name the variable and the rule, never a value.
 */
export function productionIssues(e: Env, raw: Record<string, string | undefined> = process.env): ProductionIssue[] {
  const issues: ProductionIssue[] = [];
  const add = (key: keyof Env, message: string) => issues.push({ key, message });

  const bytes = secretBytes(e.AUTH_SECRET);
  if (PLACEHOLDER.test(e.AUTH_SECRET)) {
    add("AUTH_SECRET", "looks like a dev placeholder; generate one with `openssl rand -base64 32` (this check is on format and length, not entropy)");
  } else if (bytes === null) {
    add("AUTH_SECRET", "must be hex or base64, e.g. from `openssl rand -base64 32` (this check is on format and length only, not entropy)");
  } else if (bytes < MIN_SECRET_BYTES) {
    add("AUTH_SECRET", `must decode to at least ${MIN_SECRET_BYTES} bytes (hex or base64); this is a length check, not an entropy test`);
  }

  if (isLoopback(e.ROOT_DOMAIN)) add("ROOT_DOMAIN", "must be the public domain in production, not localhost");
  if (isLoopback(e.WEB_ORIGIN)) add("WEB_ORIGIN", "must be the public guest-site origin in production, not localhost");
  if (isLoopback(e.ADMIN_ORIGIN)) add("ADMIN_ORIGIN", "must be the public admin origin in production, not localhost");
  if (!raw.WORKER_INTERNAL_URL?.trim()) add("WORKER_INTERNAL_URL", "must be set explicitly in production (the worker's private address)");

  if (!e.S3_PUBLIC_ENDPOINT) add("S3_PUBLIC_ENDPOINT", "is required in production (browser-facing bucket URL)");
  if (e.S3_ACCESS_KEY === DEV_S3_ACCESS_KEY) add("S3_ACCESS_KEY", "is the local development key; use the bucket provider's credentials");
  if (e.S3_SECRET_KEY === DEV_S3_SECRET_KEY) add("S3_SECRET_KEY", "is the local development key; use the bucket provider's credentials");

  if (e.EMAIL_PROVIDER === "console") add("EMAIL_PROVIDER", "must not be 'console' in production (guests would never get their links)");
  return issues;
}

/**
 * `next build` evaluates route modules with NODE_ENV=production and the developer's .env, so the production checks
 * are skipped then, but only while APP_ENV is unset: with APP_ENV=production the build is a production build and a
 * prerendered page must not bake in localhost values. Runtime use is always validated.
 */
function isUnlabelledNextBuild(e: Env): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" && e.APP_ENV === undefined;
}

let cached: Env | undefined;
let warnedAppEnv = false;

/** Parsed, validated process.env. Throws at first use with a readable list of what's missing. */
export function env(): Env {
  if (cached) return cached;
  const source = withoutBlanks(process.env);
  const parsed = schema.safeParse(source);
  const problems: { key: string; message: string }[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({ key: i.path.join("."), message: i.message }));

  if (parsed.success && !isUnlabelledNextBuild(parsed.data)) {
    const e = parsed.data;
    if (e.NODE_ENV === "production" && e.APP_ENV !== "production" && !warnedAppEnv) {
      warnedAppEnv = true;
      console.warn(
        e.APP_ENV
          ? "env: NODE_ENV=production but APP_ENV is not 'production', so the production environment checks are skipped"
          : "env: NODE_ENV=production without APP_ENV=production; set APP_ENV=production on every service (see docs/deploy/env.md)",
      );
    }
    if (isProduction(e)) problems.push(...productionIssues(e, source));
  }

  if (!parsed.success || problems.length > 0) {
    const issues = problems.map((p) => `  ${p.key}: ${p.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}\n(local setup: copy .env.example to .env; production: docs/deploy/env.md)`);
  }
  cached = parsed.data;
  return cached;
}

/** Hostname for an event site, e.g. priya-arjun.localhost */
export function eventHost(slug: string) {
  return `${slug}.${env().ROOT_DOMAIN}`;
}

/** Absolute origin for an event site, including the dev port when on localhost. */
export function eventOrigin(slug: string) {
  const e = env();
  const proto = e.ROOT_DOMAIN === "localhost" ? "http" : "https";
  const port = e.ROOT_DOMAIN === "localhost" ? `:${e.WEB_PORT}` : "";
  return `${proto}://${slug}.${e.ROOT_DOMAIN}${port}`;
}

/** The session cookie is shared across all event subdomains. */
export function cookieDomain() {
  const d = env().ROOT_DOMAIN;
  // Browsers reject Domain=localhost; host-only cookies are used in dev.
  return d === "localhost" ? undefined : `.${d}`;
}
