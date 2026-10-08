/**
 * GET /og.png: the single public, visitor-independent, network-free response on an event
 * host. The event is resolved from the trusted `x-hub-host` only (never `X-Forwarded-Host`,
 * which would let one URL cache another event's card), the card depends on event fields
 * only, and the PNG is buffered before any header is sent so a failure is a 500 that no
 * shared cache keeps.
 *
 * DRAFT and ARCHIVED events still get a card: signed-out visitors see the sign-in screen
 * (title + monogram) for every status, and the card shows no more than that.
 */
import { createHash } from "node:crypto";
import type { Event } from "@hub/db";
import { HUB_HOST_HEADER } from "./hubHost";
import { ogCardForEvent, type OgCard, type OgCardEvent } from "./ogCard";

/** The one asset on an event site that may be cached: it carries no content. */
export const OG_CACHE_CONTROL = "public, max-age=86400";
const NO_STORE = "private, no-store";

export type OgEvent = OgCardEvent & Pick<Event, "id" | "updatedAt">;
type Entry = { png: Uint8Array; etag: string };

export type OgCache = { get(key: string): Entry | undefined; set(key: string, e: Entry): void; size(): number };

/** Bounded LRU (Map keeps insertion order; a hit is re-inserted as most recent). */
export function createOgCache(max = 100): OgCache {
  const m = new Map<string, Entry>();
  return {
    get(key) {
      const e = m.get(key);
      if (e) {
        m.delete(key);
        m.set(key, e);
      }
      return e;
    },
    set(key, e) {
      m.delete(key);
      m.set(key, e);
      while (m.size > max) m.delete(m.keys().next().value!);
    },
    size: () => m.size,
  };
}

export type OgDeps = {
  resolveEvent(host: string): Promise<OgEvent | null>;
  render(card: OgCard): Promise<Uint8Array>;
  cache: OgCache;
};

const plain = (status: number, body: string) => new Response(body, { status, headers: { "Cache-Control": NO_STORE } });

const matches = (ifNoneMatch: string | null, etag: string) =>
  !!ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

export async function handleOgRequest(headers: Headers, deps: OgDeps): Promise<Response> {
  const host = headers.get(HUB_HOST_HEADER);
  if (!host) return plain(404, "Not found");
  const event = await deps.resolveEvent(host);
  if (!event) return plain(404, "Not found");

  const key = `${event.id}:${event.updatedAt.getTime()}`;
  let entry = deps.cache.get(key);
  if (!entry) {
    try {
      const png = await deps.render(ogCardForEvent(event));
      entry = { png, etag: `"${createHash("sha256").update(png).digest("hex").slice(0, 32)}"` };
      deps.cache.set(key, entry);
    } catch (err) {
      console.error("og.png render failed", { eventId: event.id, err });
      return plain(500, "Could not render preview");
    }
  }

  const cacheHeaders = { "Cache-Control": OG_CACHE_CONTROL, ETag: entry.etag };
  if (matches(headers.get("if-none-match"), entry.etag)) return new Response(null, { status: 304, headers: cacheHeaders });
  return new Response(new Blob([entry.png as Uint8Array<ArrayBuffer>]), {
    status: 200,
    headers: { ...cacheHeaders, "Content-Type": "image/png", "Content-Length": String(entry.png.byteLength) },
  });
}
