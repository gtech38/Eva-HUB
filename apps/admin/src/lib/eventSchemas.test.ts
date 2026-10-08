import { test } from "node:test";
import assert from "node:assert/strict";
import { EventKindSchema, ThemeKeySchema } from "./eventSchemas.ts";

test("accepts every kind and theme the database knows", () => {
  for (const k of ["WEDDING", "ENGAGEMENT", "BABY_SHOWER", "BIRTHDAY", "ANNIVERSARY", "CEREMONY", "PARTY", "CORPORATE", "OTHER"]) {
    assert.equal(EventKindSchema.parse(k), k);
  }
  for (const t of ["LUXURY", "ROMANTIC", "HINDU_TRADITIONAL", "NURSERY_SAGE", "TELUGU_TRADITIONAL", "MIDNIGHT_GALA"]) {
    assert.equal(ThemeKeySchema.parse(t), t);
  }
});

test("rejects unknown kinds and themes", () => {
  assert.equal(EventKindSchema.safeParse("FUNERAL").success, false);
  assert.equal(EventKindSchema.safeParse("wedding").success, false);
  assert.equal(EventKindSchema.safeParse("").success, false);
  assert.equal(ThemeKeySchema.safeParse("DARK").success, false);
  assert.equal(ThemeKeySchema.safeParse(undefined).success, false);
});
