import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@hub/db";

export const getStudio = cache(async (studioId: string) => {
  const s = await prisma.studio.findUnique({ where: { id: studioId } });
  if (!s) notFound();
  return s;
});

export const getEvent = cache(async (studioId: string, eventId: string) => {
  const e = await prisma.event.findFirst({ where: { id: eventId, studioId } });
  if (!e) notFound();
  return e;
});

export const studioEvents = cache(async (studioId: string) =>
  prisma.event.findMany({ where: { studioId }, orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }], select: { id: true, slug: true, title: true, status: true } }),
);

export const THEMES: Array<{ key: "LUXURY" | "ROMANTIC" | "HINDU_TRADITIONAL"; label: string; swatch: string[] }> = [
  { key: "LUXURY", label: "Luxury", swatch: ["#0b0b0b", "#c9a961", "#f5f1e8"] },
  { key: "ROMANTIC", label: "High-Class Romantic", swatch: ["#7a2e3b", "#e8b4bc", "#fbf6f4"] },
  { key: "HINDU_TRADITIONAL", label: "Elegant Hindu Traditional", swatch: ["#8b1a1a", "#d4a017", "#fff7e6"] },
];

export const PAGE_ORDER: Array<"HOME" | "ABOUT" | "SCHEDULE" | "TRAVEL" | "WEDDING_PARTY" | "FAQ" | "REGISTRY" | "GALLERY" | "RSVP"> = [
  "HOME", "ABOUT", "SCHEDULE", "TRAVEL", "WEDDING_PARTY", "FAQ", "REGISTRY", "GALLERY", "RSVP",
];
