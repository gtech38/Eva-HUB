import { describe, expect, it } from "vitest";
import "server-only";
import { eventCopy } from "@/lib/eventCopy";

describe("vitest.config.mts", () => {
  it("resolves the @/ alias from tsconfig.json and stubs server-only", () => {
    expect(eventCopy).toBeDefined();
  });
});
