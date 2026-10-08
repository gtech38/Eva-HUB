// tdd-exempt: wiring only; the export rules (vendor 403s, CSV shapes, headers, audit) live in lib/rsvpExport.ts and are tested there.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@hub/db";
import { getPrincipal } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadRsvpReport, loadWideCsv } from "@/lib/guests";
import { rsvpExport } from "@/lib/rsvpExport";

export const dynamic = "force-dynamic";

/** GET ?subEventId=...[&totals=1]; see rsvpExport() for who gets which shape. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ studioId: string; eventId: string }> }) {
  const { studioId, eventId } = await params;
  const sp = req.nextUrl.searchParams;
  const out = await rsvpExport(
    await getPrincipal(),
    { studioId, eventId },
    { subEventId: sp.get("subEventId") || null, totals: sp.get("totals") === "1" },
    {
      findEvent: (s, e) => prisma.event.findFirst({ where: { id: e, studioId: s }, select: { id: true, slug: true } }),
      loadReport: loadRsvpReport,
      loadWideCsv,
      audit,
    },
  );
  return new NextResponse(out.body, { status: out.status, headers: out.headers });
}
