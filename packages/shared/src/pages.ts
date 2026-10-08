/**
 * Typed content for each fixed page type. Stored as JSON in EventPage.content.
 * Themes render these; the admin/host editors validate against them.
 */
import { z } from "zod";

// Record with enum keys already infers Partial<Record<...>> in zod 3; `.partial()` does not exist on ZodRecord and crashed at import.
const Localized = z.record(z.enum(["en", "te", "hi"]), z.string());

export const HomeContent = z.object({
  headline: Localized.default({}),
  dateLine: Localized.default({}),
  heroKey: z.string().nullable().default(null), // storage key of hero image
});

export const AboutContent = z.object({
  story: Localized.default({}),
  photoKeys: z.array(z.string()).default([]),
});

export const ScheduleContent = z.object({
  intro: Localized.default({}),
  // The sub-events themselves come from the SubEvent table.
});

export const TravelContent = z.object({
  hotels: z.array(z.object({ name: z.string(), url: z.string().url().optional(), note: Localized.default({}) })).default([]),
  airport: Localized.default({}),
  mapUrl: z.string().url().optional(),
});

export const FaqContent = z.object({
  items: z.array(z.object({ q: Localized, a: Localized })).default([]),
});

export const WeddingPartyContent = z.object({
  members: z.array(z.object({ name: z.string(), role: Localized, photoKey: z.string().nullable().default(null), blurb: Localized.default({}) })).default([]),
});

export const RegistryContent = z.object({ intro: Localized.default({}) });
export const GalleryContent = z.object({ intro: Localized.default({}) });
export const RsvpContent = z.object({ intro: Localized.default({}) });

export const PAGE_SCHEMAS = {
  HOME: HomeContent,
  ABOUT: AboutContent,
  SCHEDULE: ScheduleContent,
  TRAVEL: TravelContent,
  WEDDING_PARTY: WeddingPartyContent,
  FAQ: FaqContent,
  REGISTRY: RegistryContent,
  GALLERY: GalleryContent,
  RSVP: RsvpContent,
} as const;

export type PageType = keyof typeof PAGE_SCHEMAS;
export type PageContent<T extends PageType> = z.infer<(typeof PAGE_SCHEMAS)[T]>;

export function parsePage<T extends PageType>(type: T, content: unknown): PageContent<T> {
  return PAGE_SCHEMAS[type].parse(content ?? {}) as PageContent<T>;
}

export const PAGE_PATHS: Record<PageType, string> = {
  HOME: "/",
  ABOUT: "/about",
  SCHEDULE: "/schedule",
  TRAVEL: "/travel",
  WEDDING_PARTY: "/party",
  FAQ: "/faq",
  REGISTRY: "/registry",
  GALLERY: "/gallery",
  RSVP: "/rsvp",
};
