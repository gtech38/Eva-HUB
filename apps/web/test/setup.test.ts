import { describe, expect, it } from "vitest";
import { env } from "@hub/shared/env";

describe("test/setup.ts", () => {
  it("loads the root .env so env() parses in tests", () => {
    expect(() => env()).not.toThrow();
    expect(env().DATABASE_URL).toMatch(/^postgres/);
  });
});
