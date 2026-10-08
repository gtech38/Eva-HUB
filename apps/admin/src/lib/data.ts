import { cache } from "react";
import { notFound } from "next/navigation";
import type { ThemeKey, EventKind } from "@hub/db";
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

export const THEMES: Array<{ key: ThemeKey; label: string; swatch: string[]; suits: string }> = [
  { key: "LUXURY", label: "Luxury", swatch: ["#580b1b", "#c9a961", "#f7ead7"], suits: "Weddings, anniversaries" },
  { key: "ROMANTIC", label: "High-Class Romantic", swatch: ["#2b2926", "#b88792", "#f6f1e8"], suits: "Weddings, engagements" },
  { key: "HINDU_TRADITIONAL", label: "Elegant Hindu Traditional", swatch: ["#450000", "#b8923e", "#f6f4ee"], suits: "Hindu weddings" },
  { key: "NURSERY_SAGE", label: "Nursery Sage", swatch: ["#8a9a7b", "#c9b280", "#fbf8f2"], suits: "Baby showers, naming ceremonies" },
  { key: "TELUGU_TRADITIONAL", label: "Telugu Traditional", swatch: ["#b3261e", "#e0a526", "#fff8e7"], suits: "Gruhapravesam, annaprasana, upanayanam, half-saree" },
  { key: "MIDNIGHT_GALA", label: "Midnight Gala", swatch: ["#050505", "#c49a25", "#f5f0e8"], suits: "Parties, birthdays, launches" },
];

export const EVENT_KINDS: Array<{ key: EventKind; label: string }> = [
  { key: "WEDDING", label: "Wedding" },
  { key: "ENGAGEMENT", label: "Engagement" },
  { key: "BABY_SHOWER", label: "Baby shower" },
  { key: "BIRTHDAY", label: "Birthday" },
  { key: "ANNIVERSARY", label: "Anniversary" },
  { key: "CEREMONY", label: "Traditional ceremony" },
  { key: "PARTY", label: "Party / gala" },
  { key: "CORPORATE", label: "Corporate" },
  { key: "OTHER", label: "Other" },
];

export const PAGE_ORDER: Array<"HOME" | "ABOUT" | "SCHEDULE" | "TRAVEL" | "WEDDING_PARTY" | "FAQ" | "REGISTRY" | "GALLERY" | "RSVP"> = [
  "HOME", "ABOUT", "SCHEDULE", "TRAVEL", "WEDDING_PARTY", "FAQ", "REGISTRY", "GALLERY", "RSVP",
];
