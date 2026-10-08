import { describe, expect, it } from "vitest";
import { EventKindSchema, ThemeKeySchema } from "./eventSchemas.ts";

describe("eventSchemas", () => {
  it("accepts every kind and theme the database knows", () => {
    for (const k of ["WEDDING", "ENGAGEMENT", "BABY_SHOWER", "BIRTHDAY", "ANNIVERSARY", "CEREMONY", "PARTY", "CORPORATE", "OTHER"]) {
      expect(EventKindSchema.parse(k)).toBe(k);
    }
    for (const t of ["LUXURY", "ROMANTIC", "HINDU_TRADITIONAL", "NURSERY_SAGE", "TELUGU_TRADITIONAL", "MIDNIGHT_GALA"]) {
      expect(ThemeKeySchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown kinds and themes", () => {
    expect(EventKindSchema.safeParse("FUNERAL").success).toBe(false);
    expect(EventKindSchema.safeParse("wedding").success).toBe(false);
    expect(EventKindSchema.safeParse("").success).toBe(false);
    expect(ThemeKeySchema.safeParse("DARK").success).toBe(false);
    expect(ThemeKeySchema.safeParse(undefined).success).toBe(false);
  });
});
