import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  EMAIL_PROVIDER: z.enum(["smtp", "console"]).default("console"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  EMAIL_FROM: z.string().default("Event Hub <hello@localhost>"),

  SMS_PROVIDER: z.enum(["console"]).default("console"),

  AUTH_SECRET: z.string().min(16),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  INVITE_SESSION_TTL_DAYS: z.coerce.number().default(90),

  WORKER_INTERNAL_URL: z.string().default("http://localhost:8010"),
  FACE_MATCH_THRESHOLD: z.coerce.number().default(0.363),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed, validated process.env. Throws at first use with a readable list of what's missing. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}\n(copy .env.example to .env)`);
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
