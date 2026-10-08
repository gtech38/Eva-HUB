import { describe, expect, it, vi } from "vitest";
import type { OgCard } from "./ogCard.tsx";
import { OG_CACHE_CONTROL, createOgCache, handleOgRequest, type OgEvent } from "./ogResponse.ts";

const at = (iso: string) => new Date(iso);
const EVENTS: Record<string, OgEvent> = {
  "priya-arjun.localhost": {
    id: "ev_priya",
    updatedAt: at("2026-10-01T00:00:00Z"),
    title: { en: "Priya & Arjun" },
    defaultLocale: "en",
    theme: "HINDU_TRADITIONAL",
    themeOverrides: { monogram: "P&A" },
  },
  "sofia-james.localhost": {
    id: "ev_sofia",
    updatedAt: at("2026-10-01T00:00:00Z"),
    title: { en: "Sofia & James" },
    defaultLocale: "en",
    theme: "LUXURY",
    themeOverrides: { monogram: "S&J" },
  },
};

function setup({ max = 10, fail = false } = {}) {
  const resolveEvent = vi.fn(async (host: string) => EVENTS[host] ?? null);
  const render = vi.fn(async (card: OgCard) => {
    if (fail) throw new Error("resvg exploded");
    return new TextEncoder().encode(`PNG:${card.title}:${card.monogram}`);
  });
  return { resolveEvent, render, cache: createOgCache(max) };
}

const req = (h: Record<string, string>) => new Headers(h);
const text = async (r: Response) => new TextDecoder().decode(await r.arrayBuffer());

describe("handleOgRequest: host", () => {
  it("resolves the event only from the trusted x-hub-host; a forged X-Forwarded-Host cannot change the card", async () => {
    const deps = setup();
    const res = await handleOgRequest(
      req({
        host: "priya-arjun.localhost:3000",
        "x-forwarded-host": "sofia-james.localhost",
        "x-hub-host": "priya-arjun.localhost",
        cookie: "hub_session=abc; hub_lang=te",
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(deps.resolveEvent).toHaveBeenCalledExactlyOnceWith("priya-arjun.localhost");
    expect(await text(res)).toBe("PNG:Priya & Arjun:P&A");
  });

  it("404s (no-store) without x-hub-host instead of falling back to Host", async () => {
    const deps = setup();
    const res = await handleOgRequest(req({ host: "priya-arjun.localhost" }), deps);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.resolveEvent).not.toHaveBeenCalled();
  });

  it("404s (no-store) for a host with no event", async () => {
    const res = await handleOgRequest(req({ "x-hub-host": "nosuch.localhost" }), setup());
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handleOgRequest: response", () => {
  it("200: a fully buffered PNG with length, public cache and a strong ETag", async () => {
    const res = await handleOgRequest(req({ "x-hub-host": "priya-arjun.localhost" }), setup());
    const body = await res.arrayBuffer();
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(body.byteLength));
    expect(res.headers.get("cache-control")).toBe(OG_CACHE_CONTROL);
    expect(OG_CACHE_CONTROL).toBe("public, max-age=86400");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("500 with private, no-store when rendering fails, and the failure is not cached", async () => {
    const deps = setup({ fail: true });
    const res = await handleOgRequest(req({ "x-hub-host": "priya-arjun.localhost" }), deps);
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("etag")).toBeNull();
    await handleOgRequest(req({ "x-hub-host": "priya-arjun.localhost" }), deps);
    expect(deps.render).toHaveBeenCalledTimes(2);
  });

  it("304 for a matching If-None-Match (plain, weak or in a list), 200 otherwise", async () => {
    const deps = setup();
    const first = await handleOgRequest(req({ "x-hub-host": "priya-arjun.localhost" }), deps);
    const etag = first.headers.get("etag")!;
    for (const inm of [etag, `W/${etag}`, `"nope", ${etag}`]) {
      const res = await handleOgRequest(req({ "x-hub-host": "priya-arjun.localhost", "if-none-match": inm }), deps);
      expect(res.status, inm).toBe(304);
      expect(res.headers.get("etag")).toBe(etag);
      expect(res.headers.get("cache-control")).toBe(OG_CACHE_CONTROL);
      expect((await res.arrayBuffer()).byteLength).toBe(0);
    }
    const miss = await handleOgRequest(req({ "x-hub-host": "priya-arjun.localhost", "if-none-match": '"other"' }), deps);
    expect(miss.status).toBe(200);
    expect(deps.render).toHaveBeenCalledTimes(1);
  });
});

describe("handleOgRequest: memo by (event.id, event.updatedAt)", () => {
  it("renders once per event version and again after the event changes", async () => {
    const deps = setup();
    const h = req({ "x-hub-host": "priya-arjun.localhost" });
    const a = await handleOgRequest(h, deps);
    await handleOgRequest(h, deps);
    expect(deps.render).toHaveBeenCalledTimes(1);

    EVENTS["priya-arjun.localhost"] = { ...EVENTS["priya-arjun.localhost"], updatedAt: at("2026-10-02T00:00:00Z"), themeOverrides: { monogram: "PA" } };
    const b = await handleOgRequest(h, deps);
    expect(deps.render).toHaveBeenCalledTimes(2);
    expect(b.headers.get("etag")).not.toBe(a.headers.get("etag"));
  });

  it("is a bounded LRU: the least recently used entry is evicted first", async () => {
    const deps = setup({ max: 2 });
    EVENTS["third.localhost"] = { ...EVENTS["sofia-james.localhost"], id: "ev_third", title: { en: "Third" } };
    const get = (host: string) => handleOgRequest(req({ "x-hub-host": host }), deps);
    await get("priya-arjun.localhost");
    await get("sofia-james.localhost");
    await get("priya-arjun.localhost"); // touch: priya is now most recent
    await get("third.localhost"); // evicts sofia
    expect(deps.cache.size()).toBe(2);
    expect(deps.render).toHaveBeenCalledTimes(3);
    await get("priya-arjun.localhost");
    expect(deps.render).toHaveBeenCalledTimes(3);
    await get("sofia-james.localhost");
    expect(deps.render).toHaveBeenCalledTimes(4);
  });
});
