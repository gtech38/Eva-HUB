import { isIP } from "node:net";
import { env, withoutBlanks } from "./env.ts";

/**
 * The client address for per-IP rate limits and face-search ipHash (SHR-003).
 *
 * Trust model: production runs behind `TRUSTED_PROXY_HOPS` proxies (env(), default 1) that each APPEND
 * the address they saw to `X-Forwarded-For` (nginx `$proxy_add_x_forwarded_for` and most managed load
 * balancers do; how many entries a platform appends varies, e.g. GCP's external Application LB adds
 * two, so the deploy must check it: docs/deploy/env.md, DOC-006). The client is the Nth entry from
 * the right, counted on the raw list; everything to its left was written by the client and ignored.
 * Only that entry is normalised: if it is not an address (nginx on a unix socket writes `unix:`,
 * Squid writes `unknown`), the answer is the shared `UNKNOWN_CLIENT` bucket, never a client entry.
 *
 * IPv4-mapped IPv6 becomes IPv4; other IPv6 addresses are grouped by /64 (one subscriber), so rotating
 * the interface id does not reset a limit. Per-IP limits are skipped (`null`) only when the mode is
 * explicitly development or test (APP_ENV, else NODE_ENV); every other mode, including none, gets the
 * shared bucket (fail closed), logged once per process.
 */
export const UNKNOWN_CLIENT = "unknown";

export type ClientIpOptions = { hops?: number; production?: boolean };

let warnedUnknown = false;

export function clientIp(headers: Pick<Headers, "get">, opts: ClientIpOptions = {}): string | null {
  const production = opts.production ?? !isDevOrTestMode();
  const hops = opts.hops ?? env().TRUSTED_PROXY_HOPS;
  const raw = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
  const ip = normalizeIp(raw[Math.max(0, raw.length - hops)] ?? "");
  if (ip) return ip;
  if (!production) return null;
  if (!warnedUnknown) {
    warnedUnknown = true;
    console.warn(
      "[clientIp] no client address at the trusted X-Forwarded-For position; per-IP limits now share one bucket. Check TRUSTED_PROXY_HOPS and the proxy (docs/deploy/env.md).",
    );
  }
  return UNKNOWN_CLIENT;
}

/** Per-IP limits are skipped only in an explicit development or test mode (APP_ENV wins; blank = unset). */
function isDevOrTestMode(): boolean {
  const e = withoutBlanks({ APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV });
  const mode = e.APP_ENV ?? e.NODE_ENV;
  return mode === "development" || mode === "test";
}

const V4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** One X-Forwarded-For entry -> IPv4, or IPv6 /64 prefix, or null when it is not an address. */
export function normalizeIp(entry: string): string | null {
  let s = entry.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1]!;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return null;
  const g = ipv6Groups(s.toLowerCase());
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join(".");
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** Eight 16-bit groups of a valid IPv6 address (handles `::` and a dotted IPv4 tail). */
function ipv6Groups(addr: string): number[] {
  let a = addr;
  let tail: number[] = [];
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (dotted && V4.test(dotted[1]!)) {
    const [p, q, r, t] = dotted[1]!.split(".").map(Number) as [number, number, number, number];
    tail = [(p << 8) | q, (r << 8) | t];
    a = a.slice(0, -dotted[1]!.length);
    if (a.endsWith(":") && !a.endsWith("::")) a = a.slice(0, -1);
  }
  const double = a.indexOf("::");
  const part = (s: string) => (s ? s.split(":") : []);
  const head = part(double === -1 ? a : a.slice(0, double));
  const rest = double === -1 ? [] : part(a.slice(double + 2));
  const fill = double === -1 ? [] : Array<string>(8 - tail.length - head.length - rest.length).fill("0");
  return [...[...head, ...fill, ...rest].map((x) => parseInt(x, 16)), ...tail];
}
