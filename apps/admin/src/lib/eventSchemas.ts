/**
 * Zod schemas for enum-valued event fields, derived from the Prisma enums so the list of
 * valid themes/kinds lives in exactly one place (packages/db/prisma/schema.prisma).
 */
import { z } from "zod";
import { EventKind, ThemeKey } from "@hub/db";

export const EventKindSchema = z.nativeEnum(EventKind);
export const ThemeKeySchema = z.nativeEnum(ThemeKey);

export type EventKindValue = z.infer<typeof EventKindSchema>;
export type ThemeKeyValue = z.infer<typeof ThemeKeySchema>;
