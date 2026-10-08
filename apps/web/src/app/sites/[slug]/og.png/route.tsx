// tdd-exempt: wiring only; behaviour lives in lib/ogResponse, lib/ogRender and lib/ogFonts (tested).
/**
 * GET /og.png on an event host: the link-preview image. Public, visitor-independent and
 * network-free: resolveEvent(trusted host) -> ogCardForEvent -> local-font render, memoised
 * per event version. No session, cookie or getSite() read. Node runtime (resvg is native).
 */
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { resolveEvent } from "@/lib/site";
import { loadOgFonts, type OgFonts } from "@/lib/ogFonts";
import { renderOgPng } from "@/lib/ogRender";
import { createOgCache, handleOgRequest } from "@/lib/ogResponse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cache = createOgCache(200);
let fonts: Promise<OgFonts> | undefined;
function ogFonts(): Promise<OgFonts> {
  fonts ??= loadOgFonts(join(process.cwd(), "assets/og-fonts")).catch((err) => {
    fonts = undefined; // retry on the next request rather than caching the failure
    throw err;
  });
  return fonts;
}

export async function GET(req: NextRequest) {
  return handleOgRequest(req.headers, {
    resolveEvent,
    render: async (card) => renderOgPng(card, await ogFonts()),
    cache,
  });
}
