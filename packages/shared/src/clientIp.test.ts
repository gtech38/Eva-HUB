/**
 * SHR-003 review: the client address used for per-IP rate limits. Behind N trusted proxies that
 * APPEND to X-Forwarded-For, the client is the Nth entry from the right; everything left of it is
 * client-controlled. Pure: no env reads (hops and production are passed in).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, trustedProxyHops, UNKNOWN_CLIENT } from "./clientIp.ts";

const xff = (value?: string) => new Headers(value === undefined ? {} : { "x-forwarded-for": value });
const dev = { hops: 1, production: false };
const prod = { hops: 1, production: true };

describe("clientIp", () => {
  it("with one appending proxy, takes the rightmost entry, not the client-supplied first hop", () => {
    expect(clientIp(xff("203.0.113.9"), prod)).toBe("203.0.113.9");
    expect(clientIp(xff("6.6.6.6, 203.0.113.9"), prod), "spoofed first hop ignored").toBe("203.0.113.9");
  });

  it("with two trusted proxies, takes the second entry from the right", () => {
    expect(clientIp(xff("6.6.6.6, 203.0.113.9, 10.0.0.2"), { hops: 2, production: true })).toBe("203.0.113.9");
  });

  it("a chain shorter than the trusted hops falls back to its leftmost valid entry", () => {
    expect(clientIp(xff("203.0.113.9"), { hops: 2, production: true })).toBe("203.0.113.9");
  });

  it("ignores empty and non-IP entries, so ', x' cannot blank the address", () => {
    expect(clientIp(xff(", 203.0.113.9"), prod)).toBe("203.0.113.9");
    expect(clientIp(xff("203.0.113.9, "), prod)).toBe("203.0.113.9");
    expect(clientIp(xff("203.0.113.9, not-an-ip, unknown"), prod)).toBe("203.0.113.9");
  });

  it("normalises IPv4-mapped IPv6 to IPv4 and strips ports", () => {
    expect(clientIp(xff("::ffff:203.0.113.9"), prod)).toBe("203.0.113.9");
    expect(clientIp(xff("203.0.113.9:51234"), prod)).toBe("203.0.113.9");
    expect(clientIp(xff("[2001:db8::1]:443"), prod)).toBe("2001:db8:0:0::/64");
  });

  it("groups IPv6 clients by /64, so rotating the interface id does not reset the limit", () => {
    expect(clientIp(xff("2001:db8:aa:bb:1:2:3:4"), prod)).toBe("2001:db8:aa:bb::/64");
    expect(clientIp(xff("2001:0DB8:00aa:bb::ffff"), prod)).toBe("2001:db8:aa:bb::/64");
    expect(clientIp(xff("2001:db8::1"), prod)).toBe("2001:db8:0:0::/64");
    expect(clientIp(xff("::1"), prod)).toBe("0:0:0:0::/64");
  });

  it("missing or useless header: a shared bucket in production, unlimited (null) in development", () => {
    for (const h of [undefined, "", " , ", "garbage"]) {
      expect(clientIp(xff(h), prod), JSON.stringify(h)).toBe(UNKNOWN_CLIENT);
      expect(clientIp(xff(h), dev), JSON.stringify(h)).toBeNull();
    }
  });
});

describe("clientIp production default", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("follows the repo rule: APP_ENV wins over NODE_ENV", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ENV", "production");
    expect(clientIp(xff())).toBe(UNKNOWN_CLIENT);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "development");
    expect(clientIp(xff())).toBeNull();
    vi.stubEnv("APP_ENV", " ");
    expect(clientIp(xff()), "a blank APP_ENV is unset, so NODE_ENV decides").toBe(UNKNOWN_CLIENT);
  });
});

describe("trustedProxyHops", () => {
  it("defaults to 1 and accepts 1..10", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: " 2 " })).toBe(2);
  });

  it.each(["0", "-1", "11", "1.5", "two"])("rejects %j", (bad) => {
    expect(() => trustedProxyHops({ TRUSTED_PROXY_HOPS: bad })).toThrow(/TRUSTED_PROXY_HOPS/);
  });
});
