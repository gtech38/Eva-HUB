import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "./middleware.ts";

const forged = { "x-hub-host": "sofia-james.localhost", "x-forwarded-host": "sofia-james.localhost" };
const call = (url: string, headers: Record<string, string>) => middleware(new NextRequest(url, { headers }));
/** Request headers a rewrite forwards are exposed as x-middleware-request-<name>. */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe("middleware: trusted host", () => {
  it("sets x-hub-host from Host, overwriting a client value and ignoring X-Forwarded-Host", () => {
    const res = call("http://priya-arjun.localhost:3000/og.png", { host: "Priya-Arjun.localhost:3000", ...forged });
    expect(res.headers.get("x-middleware-rewrite")).toContain("/sites/priya-arjun/og.png");
    expect(forwarded(res, "x-hub-host")).toBe("priya-arjun.localhost");
  });

  it("overwrites x-hub-host on the root host too", () => {
    const res = call("http://localhost:3000/", { host: "localhost:3000", ...forged });
    expect(forwarded(res, "x-hub-host")).toBe("localhost");
  });
});

describe("middleware: ROOT_DOMAIN (blank means unset, as in env())", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** ROOT_DOMAIN is read at module load, so import a fresh copy per case. */
  async function middlewareWith(rootDomain: string | undefined) {
    vi.stubEnv("ROOT_DOMAIN", rootDomain);
    vi.resetModules();
    return (await import("./middleware.ts")).middleware;
  }

  it.each([undefined, "", "   "])("ROOT_DOMAIN=%j routes localhost to the root site", async (value) => {
    const mw = await middlewareWith(value);
    const res = mw(new NextRequest("http://localhost:3000/", { headers: { host: "localhost:3000" } }));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/root");
  });

  it("an explicit ROOT_DOMAIN is used, case-insensitively and trimmed", async () => {
    const mw = await middlewareWith(" Studio.Example.com ");
    const res = mw(new NextRequest("https://studio.example.com/", { headers: { host: "studio.example.com" } }));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/root");
  });
});

describe("middleware: matcher", () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("routes /og.png per site; other images and Next internals are skipped", () => {
    expect(runs("/og.png")).toBe(true);
    expect(runs("/gallery/abc")).toBe(true);
    expect(runs("/foo.png")).toBe(false);
    expect(runs("/_next/static/chunks/a.js")).toBe(false);
  });

  it("does not treat /OG.png as the preview route (it falls through to 404)", () => {
    expect(runs("/OG.png")).toBe(false);
  });

  it("always rewrites literal /sites/* and /root/* paths, so no route is reachable without a trusted x-hub-host", () => {
    expect(runs("/sites/priya-arjun/og.png")).toBe(true);
    expect(runs("/root/x.png")).toBe(true);
  });
});
