/**
 * SHR-003: the client address used for per-IP rate limits. Behind N trusted proxies that APPEND to
 * X-Forwarded-For, the client is the Nth entry from the right, counted on the raw list; everything
 * left of it is client-written. Only the selected entry is normalised: if the trusted proxy wrote
 * something that is not an IP (nginx `unix:`, Squid `unknown`), production answers UNKNOWN_CLIENT
 * rather than sliding left into client-controlled entries. Hops are passed in (env() supplies them
 * in the apps); the mode comes from APP_ENV/NODE_ENV, stubbed with vi.stubEnv.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, UNKNOWN_CLIENT } from "./clientIp.ts";

const xff = (value?: string) => new Headers(value === undefined ? {} : { "x-forwarded-for": value });
const dev = { hops: 1, production: false };
const prod = { hops: 1, production: true };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("clientIp", () => {
  it("with one appending proxy, takes the rightmost entry, not the client-supplied first hop", () => {
    expect(clientIp(xff("203.0.113.9"), prod)).toBe("203.0.113.9");
    expect(clientIp(xff("6.6.6.6, 203.0.113.9"), prod), "spoofed first hop ignored").toBe("203.0.113.9");
    expect(clientIp(xff(", 203.0.113.9"), prod), "a client-written blank entry changes nothing").toBe("203.0.113.9");
  });

  it("with two trusted proxies, takes the second entry from the right", () => {
    expect(clientIp(xff("6.6.6.6, 203.0.113.9, 10.0.0.2"), { hops: 2, production: true })).toBe("203.0.113.9");
  });

  it("a chain shorter than the trusted hops falls back to its leftmost entry", () => {
    expect(clientIp(xff("203.0.113.9"), { hops: 2, production: true })).toBe("203.0.113.9");
  });

  it("counts positions on the raw list: a non-IP at the trusted position is UNKNOWN, never the client's entry to its left", () => {
    expect(clientIp(xff("6.6.6.6, unknown"), prod), "Squid writes `unknown`").toBe(UNKNOWN_CLIENT);
    expect(clientIp(xff("6.6.6.6, unix:"), prod), "nginx on a unix socket writes `unix:`").toBe(UNKNOWN_CLIENT);
    expect(clientIp(xff("203.0.113.9, not-an-ip, unknown"), prod)).toBe(UNKNOWN_CLIENT);
    expect(clientIp(xff("203.0.113.9, "), prod)).toBe(UNKNOWN_CLIENT);
    expect(clientIp(xff("6.6.6.6, unknown"), dev), "development skips per-IP limits instead").toBeNull();
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

describe("clientIp mode default", () => {
  const mode = (APP_ENV: string, NODE_ENV: string) => {
    vi.stubEnv("APP_ENV", APP_ENV);
    vi.stubEnv("NODE_ENV", NODE_ENV);
    return clientIp(xff(), { hops: 1 });
  };

  it("skips per-IP limits only for an explicit development or test mode; APP_ENV wins over NODE_ENV", () => {
    expect(mode("", "development")).toBeNull();
    expect(mode("", "test")).toBeNull();
    expect(mode("test", "production")).toBeNull();
    expect(mode("production", "development")).toBe(UNKNOWN_CLIENT);
    expect(mode(" ", "production"), "a blank APP_ENV is unset, so NODE_ENV decides").toBe(UNKNOWN_CLIENT);
  });

  it("anything else, including no mode at all, is treated as production (fail closed)", () => {
    expect(mode("", "")).toBe(UNKNOWN_CLIENT);
    expect(mode("staging", "")).toBe(UNKNOWN_CLIENT);
  });

  it("logs the production fallback to the shared bucket once per process, without the header", async () => {
    vi.resetModules();
    const fresh = await import("./clientIp.ts");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fresh.clientIp(xff("6.6.6.6, unknown"), prod);
    fresh.clientIp(xff(), prod);
    fresh.clientIp(xff("203.0.113.9"), prod);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toMatch(/TRUSTED_PROXY_HOPS/);
    expect(String(warn.mock.calls[0])).not.toContain("6.6.6.6");
  });
});
