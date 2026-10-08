import { prisma } from "@hub/db";
import { acquireSlot, limit, type LimitResult, type RateLimitStore, type RateWindow, type Slot } from "./ratelimit.ts";

/**
 * Every rate limit in the product, in one place (SHR-003). Override one with
 * `RATE_LIMIT_<POLICY_IN_SNAKE_CASE>=max/windowSec`, e.g. `RATE_LIMIT_SIGN_IN_ADDRESS=5/900`.
 * For `faceSearchConcurrent`, `max` is simultaneous searches and `windowSec` the lease TTL.
 */
export const RATE_LIMITS = {
  signInAddress: { max: 5, windowSec: 15 * 60 },
  signInIp: { max: 30, windowSec: 15 * 60 },
  otpVerifyAddress: { max: 10, windowSec: 15 * 60 }, // applied by the OTP verify step (SHR-002)
  inviteIp: { max: 60, windowSec: 60 * 60 },
  faceSearchUser: { max: 10, windowSec: 60 * 60 },
  faceSearchConcurrent: { max: 3, windowSec: 60 },
  adminMagicLinkAddress: { max: 5, windowSec: 15 * 60 },
} as const satisfies Record<string, RateWindow>;

export type RatePolicy = keyof typeof RATE_LIMITS;

type EnvSource = Record<string, string | undefined>;

export const envName = (policy: RatePolicy) => `RATE_LIMIT_${policy.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

/** The effective policies: defaults with env overrides. Throws on a malformed override. */
export function ratePolicies(source: EnvSource = process.env): Record<RatePolicy, RateWindow> {
  const out = {} as Record<RatePolicy, RateWindow>;
  for (const policy of Object.keys(RATE_LIMITS) as RatePolicy[]) {
    const name = envName(policy);
    const raw = source[name]?.trim();
    if (!raw) {
      out[policy] = { ...RATE_LIMITS[policy] };
      continue;
    }
    const m = /^(\d+)\/(\d+)$/.exec(raw);
    const max = Number(m?.[1]);
    const windowSec = Number(m?.[2]);
    if (!m || max < 1 || windowSec < 1) throw new Error(`${name} must be "max/windowSec" with positive integers, got ${JSON.stringify(raw)}`);
    out[policy] = { max, windowSec };
  }
  return out;
}

/**
 * Client IP for per-IP limits: the first hop of `x-forwarded-for`.
 *
 * Trust assumption: production runs behind exactly one reverse proxy that REPLACES any client-sent
 * `x-forwarded-for` with the connecting address. A proxy that appends instead would let a client
 * choose its own first hop and dodge per-IP limits (per-address limits still hold). No header means
 * no proxy (local dev): `null`, and per-IP policies do not apply.
 */
export function clientIp(headers: Pick<Headers, "get">): string | null {
  const first = (headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  return first ? first : null;
}

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
};

const auditToDb = async (e: RateAuditEntry) => {
  await prisma.auditLog.create({ data: e });
};

const UNLIMITED: LimitResult = { ok: true, remaining: Number.POSITIVE_INFINITY, retryAfterSec: 0, keyHash: "", tripped: false };

/**
 * Policy-aware limiter. Keys are `"<policy>:<value>"` (hashed by `limit()`); the first refusal of a
 * window writes one `auth.rate_limited` audit row carrying the hashed key only.
 */
export function rateLimiter(deps: RateLimiterDeps = {}) {
  const { store, audit = auditToDb, env = process.env, random } = deps;

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
    /** Count one hit of `value` against `policy`. `null` (e.g. unknown client IP) is not limited. */
    async check(policy: RatePolicy, value: string | null, ctx: RateContext = {}): Promise<LimitResult> {
      if (value === null) return UNLIMITED;
      const r = await limit(`${policy}:${value}`, ratePolicies(env)[policy], { now: ctx.now, store, random });
      if (r.tripped) await record(policy, r.keyHash, r.retryAfterSec, ctx);
      return r;
    },
    /** Take a concurrency slot; release it in `finally`. A refusal is audited. */
    async acquire(policy: RatePolicy, value: string, ctx: RateContext = {}): Promise<Slot> {
      const slot = await acquireSlot(`${policy}:${value}`, ratePolicies(env)[policy], { now: ctx.now, store });
      if (!slot.ok) await record(policy, slot.keyHash, slot.retryAfterSec, ctx);
      return slot;
    },
  };
}

export type RateLimiter = ReturnType<typeof rateLimiter>;

/** The production limiter: Postgres store, AuditLog sink, process.env overrides. */
export const rateLimits: RateLimiter = rateLimiter();
