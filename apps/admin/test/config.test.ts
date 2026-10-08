import { describe, expect, it } from "vitest";
import "server-only";
import { EventKindSchema } from "@/lib/eventSchemas";

describe("vitest.config.mts", () => {
  it("resolves the @/ alias from tsconfig.json and stubs server-only", () => {
    expect(EventKindSchema).toBeDefined();
  });
});
