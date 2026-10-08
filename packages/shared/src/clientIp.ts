import { isIP } from "node:net";

/**
 * The client address for per-IP rate limits (SHR-003).
 *
 * Trust model: production runs behind `TRUSTED_PROXY_HOPS` proxies (default 1) that each APPEND the
 * address they saw to `X-Forwarded-For` (Fly, Cloud Run, Render, ALB, Railway, nginx
 * `$proxy_add_x_forwarded_for`). The client is therefore the Nth valid entry from the right;
 * everything to its left was written by the client and is ignored. Empty and non-IP entries are
 * skipped so `", x"` cannot blank the address.
 *
 * IPv4-mapped IPv6 becomes IPv4; other IPv6 addresses are grouped by /64 (one subscriber), so rotating
 * the interface id does not reset a limit. Without a usable header, production returns one shared
 * `UNKNOWN_CLIENT` bucket (fail closed); development returns `null` and per-IP limits do not apply.
 */
export const UNKNOWN_CLIENT = "unknown";

type EnvSource = Record<string, string | undefined>;

export type ClientIpOptions = { hops?: number; production?: boolean };

/** `TRUSTED_PROXY_HOPS`, 1..10, default 1. Throws on anything else (validated at boot). */
export function trustedProxyHops(source: EnvSource = process.env): number {
  const raw = source.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > 10) throw new Error(`TRUSTED_PROXY_HOPS must be an integer 1..10, got ${JSON.stringify(raw)}`);
  return n;
}

export function clientIp(headers: Pick<Headers, "get">, opts: ClientIpOptions = {}): string | null {
  const hops = opts.hops ?? trustedProxyHops();
  const production = opts.production ?? process.env.NODE_ENV === "production";
  const valid = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(normalizeIp)
    .filter((ip): ip is string => ip !== null);
  if (valid.length === 0) return production ? UNKNOWN_CLIENT : null;
  return valid[Math.max(0, valid.length - hops)]!;
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
