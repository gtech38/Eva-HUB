import { prisma } from "@hub/db";
import { parseTrustedProxyHops } from "./env.ts";
import { acquireSlot, limit, type LimitResult, type RateLimitStore, type RateWindow, type Slot } from "./ratelimit.ts";

/**
 * Every rate limit in the product, in one place (SHR-003). Override one with
 * `RATE_LIMIT_<POLICY_IN_SNAKE_CASE>=max/windowSec`, e.g. `RATE_LIMIT_SIGN_IN_ADDRESS_IP=5/900`.
 * Overrides are validated at server boot (`validateRateLimitConfig`, apps' instrumentation.ts).
 *
 * Shape of the sign-in limits: the strict per-address limit is keyed on (address, client IP), so a
 * stranger elsewhere cannot burn a guest's attempts; a looser address-only cap still bounds an
 * attacker who rotates IPs (who can therefore still delay one address for up to 15 minutes; that is
 * the accepted residual). Per-IP limits are deliberately loose because venue Wi-Fi and carrier NAT put
 * many real guests behind one address; the per-address limits are the real control.
 * For `faceSearchConcurrent`, `max` is simultaneous searches and `windowSec` the lease TTL.
 */
export const RATE_LIMITS = {
  signInIp: { max: 60, windowSec: 15 * 60 },
  signInAddressIp: { max: 5, windowSec: 15 * 60 },
  signInAddress: { max: 20, windowSec: 15 * 60 },
  otpVerifyAddress: { max: 10, windowSec: 15 * 60 }, // applied by the OTP verify step (SHR-027)
  inviteIp: { max: 200, windowSec: 60 * 60 },
  faceSearchUser: { max: 10, windowSec: 60 * 60 },
  faceSearchConcurrent: { max: 3, windowSec: 60 },
  adminMagicLinkIp: { max: 60, windowSec: 15 * 60 },
  adminMagicLinkAddressIp: { max: 5, windowSec: 15 * 60 },
  adminMagicLinkAddress: { max: 20, windowSec: 15 * 60 },
} as const satisfies Record<string, RateWindow>;

export type RatePolicy = keyof typeof RATE_LIMITS;

/** Bounds for overrides: keep `max` and `windowSec` well inside Postgres `int`. */
export const OVERRIDE_BOUNDS = { max: 1_000_000, windowSec: 7 * 24 * 3600 } as const;

type EnvSource = Record<string, string | undefined>;

export const envName = (policy: RatePolicy) => `RATE_LIMIT_${policy.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

/** The effective policies: defaults with env overrides. Throws on a malformed or out-of-bounds override. */
export function ratePolicies(source: EnvSource = process.env): Record<RatePolicy, RateWindow> {
  const out = {} as Record<RatePolicy, RateWindow>;
  for (const policy of Object.keys(RATE_LIMITS) as RatePolicy[]) {
    const name = envName(policy);
    const raw = source[name]?.trim();
    if (!raw) {
      out[policy] = { ...RATE_LIMITS[policy] };
      continue;
    }
    const m = /^(\d{1,9})\/(\d{1,9})$/.exec(raw);
    const max = Number(m?.[1]);
    const windowSec = Number(m?.[2]);
    if (!m || max < 1 || windowSec < 1 || max > OVERRIDE_BOUNDS.max || windowSec > OVERRIDE_BOUNDS.windowSec) {
      throw new Error(
        `${name} must be "max/windowSec" with 1 <= max <= ${OVERRIDE_BOUNDS.max} and 1 <= windowSec <= ${OVERRIDE_BOUNDS.windowSec}, got ${JSON.stringify(raw)}`,
      );
    }
    out[policy] = { max, windowSec };
  }
  return out;
}

/** Check every rate-limit setting (RATE_LIMIT_* and TRUSTED_PROXY_HOPS); throws on the first bad one. */
export function validateRateLimitConfig(source: EnvSource = process.env): void {
  ratePolicies(source);
  parseTrustedProxyHops(source);
}

/**
 * Boot hook for each app's src/instrumentation.ts. A throw from register() does not stop Next (it
 * caches the failure and keeps serving 500s), so a bad setting logs the reason and exits with 1.
 */
export function exitOnInvalidRateLimitConfig(
  source: EnvSource = process.env,
  deps: { exit: (code: number) => void; log: (message: string) => void } = {
    exit: (code) => process.exit(code),
    log: (message) => console.error(message),
  },
): void {
  try {
    validateRateLimitConfig(source);
  } catch (err) {
    deps.log(`[rate-limits] invalid configuration, refusing to start: ${(err as Error).message}`);
    deps.exit(1);
  }
}

/** Value for the `*AddressIp` policies: one budget per address per client network. */
export const addressAtIp = (address: string, ip: string | null) => `${address}|${ip ?? "-"}`;

export type RateContext = { studioId?: string | null; eventId?: string | null; actorUserId?: string | null; now?: Date };

export type RateAuditEntry = {
  action: "auth.rate_limited";
  studioId: string | null;
  eventId: string | null;
  actorUserId: string | null;
  data: { policy: RatePolicy; key: string; retryAfterSec: number };
};

export type RateLimiterDeps = {
  store?: RateLimitStore;
  audit?: (entry: RateAuditEntry) => Promise<void>;
  env?: EnvSource;
  random?: () => number;
  /** HMAC key for stored and audited keys; defaults to AUTH_SECRET. */
  secret?: string;
};

const auditToDb = async (e: RateAuditEntry) => {
  await prisma.auditLog.create({ data: e });
};

const UNLIMITED: LimitResult = { ok: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSec: 0, keyHash: "", tripped: false };

/**
 * Policy-aware limiter. Keys are `"<policy>:<value>"` (HMAC'd by `limit()`); the first refusal of a
 * window writes one `auth.rate_limited` audit row carrying the HMAC'd key only. Overrides are parsed
 * once, here, so a bad value fails at construction (boot), never mid-request.
 */
export function rateLimiter(deps: RateLimiterDeps = {}) {
  const { store, audit = auditToDb, random, secret } = deps;
  const policies = ratePolicies(deps.env ?? process.env);

  const record = async (policy: RatePolicy, keyHash: string, retryAfterSec: number, ctx: RateContext) => {
    const entry: RateAuditEntry = {
      action: "auth.rate_limited",
      studioId: ctx.studioId ?? null,
      eventId: ctx.eventId ?? null,
      actorUserId: ctx.actorUserId ?? null,
      data: { policy, key: keyHash, retryAfterSec },
    };
    // Losing an audit row must never turn a refusal into a pass.
    await audit(entry).catch((err: unknown) => console.error("[ratelimit] audit failed", (err as Error).message));
  };

  return {
    /** Count one hit of `value` against `policy`. `null` (development, no proxy header) is not limited. */
    async check(policy: RatePolicy, value: string | null, ctx: RateContext = {}): Promise<LimitResult> {
      if (value === null) return UNLIMITED;
      const r = await limit(`${policy}:${value}`, policies[policy], { now: ctx.now, store, random, secret });
      if (r.tripped) await record(policy, r.keyHash, r.retryAfterSec, ctx);
      return r;
    },
    /** Take a concurrency slot; release it in `finally`. Refusals are audited once per lease window. */
    async acquire(policy: RatePolicy, value: string, ctx: RateContext = {}): Promise<Slot> {
      const w = policies[policy];
      const slot = await acquireSlot(`${policy}:${value}`, w, { now: ctx.now, store, secret });
      if (!slot.ok) {
        // Count refusals in their own window with max 0: `tripped` marks the first refusal only.
        const refusals = await limit(`${policy}.refused:${value}`, { max: 0, windowSec: w.windowSec }, { now: ctx.now, store, random, secret });
        if (refusals.tripped) await record(policy, slot.keyHash, slot.retryAfterSec, ctx);
      }
      return slot;
    },
  };
}

export type RateLimiter = ReturnType<typeof rateLimiter>;

let instance: RateLimiter | undefined;

/** The production limiter (Postgres store, AuditLog sink, process.env overrides), built on first use. */
export const rateLimits: RateLimiter = {
  check: (...a) => (instance ??= rateLimiter()).check(...a),
  acquire: (...a) => (instance ??= rateLimiter()).acquire(...a),
};
